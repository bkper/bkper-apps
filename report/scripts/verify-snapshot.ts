/**
 * Read-only check of the Book snapshot against live Books.
 *
 *     npx tsx scripts/verify-snapshot.ts [--today=YYYY-MM-DD] <bookId> [<bookId> ...]
 *
 * `--today` reads the Books as of an earlier day, as the snapshot of that day holds them.
 *
 * The snapshot is the Book's map, its structure alone: it holds no amounts and no months. For
 * each Book it times cold loads (no cache) and a warm load, checks that a load asks Bkper for no
 * balances query, and checks the snapshot against `bkper group list` and `bkper account list`:
 * the roots, the subgroups and accounts under each group by name, every group's name, nature, parent, subgroups and accounts
 * (archived ones too), every account's name and nature, and the accounts in no group. Uses your
 * `bkper auth token`; never writes to a Book.
 */
import { execFileSync } from 'node:child_process';
import { Bkper, type Book } from 'bkper-js';
import { byName, type Snapshot, type SnapshotAccount } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const COLD_LOADS = 3;

interface CliGroup {
    id: string;
    name: string;
    type?: string;
    mixed?: boolean;
    credit?: boolean;
    permanent?: boolean;
    parent?: { id: string };
}

interface CliAccount {
    id: string;
    name: string;
    type?: string;
    credit?: boolean;
    permanent?: boolean;
    archived?: boolean;
    groups?: { id: string }[];
}

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

/** A Bkper client that counts the balances queries of the Books it loads. */
class CountingBkper extends Bkper {
    queries = 0;

    override async getBook(id: string, accounts?: boolean, groups?: boolean): Promise<Book> {
        const book = await super.getBook(id, accounts, groups);
        const read = book.getBalancesReport.bind(book);
        book.getBalancesReport = async (query: string) => {
            this.queries++;
            return read(query);
        };
        return book;
    }
}

function isSorted(nodes: { name: string }[]): boolean {
    return nodes.every((node, i) => i === 0 || byName(nodes[i - 1], node) <= 0);
}

function cli(args: string[]): string {
    return execFileSync('bkper', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let failures = 0;

function check(ok: boolean, message: string): void {
    if (!ok) {
        failures++;
    }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

async function verifyBook(bkper: CountingBkper, bookId: string, now: () => Date): Promise<void> {
    const userId = await currentUserId(bkper, new ServerTiming());
    const timings: number[] = [];
    let snapshot: Snapshot | undefined;
    bkper.queries = 0;
    for (let i = 0; i < COLD_LOADS; i++) {
        const timing = new ServerTiming();
        const start = performance.now();
        snapshot = await loadSnapshot(bookId, {
            userId,
            bkper,
            kv: new MemoryStore(),
            timing,
            now,
        });
        const elapsed = performance.now() - start;
        timings.push(elapsed);
        console.log(`  cold load ${i + 1}: ${Math.round(elapsed)} ms (${timing.header()})`);
    }
    if (!snapshot) {
        return;
    }
    check(bkper.queries === 0, `${COLD_LOADS} cold loads asked ${bkper.queries} balances queries`);
    const store = new MemoryStore();
    await loadSnapshot(bookId, { userId, bkper, kv: store, timing: new ServerTiming(), now });
    const warmTiming = new ServerTiming();
    const warmStart = performance.now();
    await loadSnapshot(bookId, { userId, bkper, kv: store, timing: warmTiming, now });
    console.log(
        `  warm load: ${Math.round(performance.now() - warmStart)} ms (${warmTiming.header()})`
    );

    const sorted = [...timings].sort((a, b) => a - b);
    console.log(
        `  "${snapshot.book.name}": ${snapshot.roots.length} roots, ${Object.keys(snapshot.groups).length} groups, ` +
            `${Object.keys(snapshot.accounts).length} accounts, ` +
            `${Object.keys(snapshot.ungrouped).length} in no group, today ${snapshot.today}, ` +
            `${Math.round(JSON.stringify(snapshot).length / 1024)} KiB; cold median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms`
    );

    verifyTree(bookId, snapshot);
}

function verifyTree(bookId: string, snapshot: Snapshot): void {
    const groups = (JSON.parse(cli(['group', 'list', '-b', bookId])) as { items: CliGroup[] })
        .items;
    const accounts = (JSON.parse(cli(['account', 'list', '-b', bookId])) as { items: CliAccount[] })
        .items;
    const sameSet = (a: string[], b: string[]) =>
        a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

    // Bkper lists root groups in no stable order, so only the set is compared.
    const roots = groups.filter(group => !group.parent).map(group => group.id);
    check(sameSet(snapshot.roots, roots), `roots match bkper group list (${roots.length})`);
    const ordered = Object.values(snapshot.groups).every(
        group =>
            isSorted(group.groups.map(id => snapshot.groups[id])) &&
            isSorted(group.accounts.map(id => snapshot.accounts[id]))
    );
    check(ordered, 'subgroups and accounts under each group by name');
    check(
        sameSet(
            Object.keys(snapshot.groups),
            groups.map(group => group.id)
        ),
        `${groups.length} groups, as bkper group list lists them`
    );
    const problems: string[] = [];
    for (const group of groups) {
        const node = snapshot.groups[group.id];
        if (!node) {
            problems.push(`${group.name} is missing`);
            continue;
        }
        const children = groups.filter(g => g.parent?.id === group.id).map(g => g.id);
        const members = accounts
            .filter(account => account.groups?.some(g => g.id === group.id))
            .map(account => account.id);
        const type = group.mixed || !group.type ? 'MIXED' : group.type;
        if (
            node.name !== group.name ||
            node.type !== type ||
            node.credit !== (group.credit ?? false) ||
            node.permanent !== (group.permanent ?? false) ||
            node.parent !== group.parent?.id ||
            !sameSet(node.groups, children) ||
            !sameSet(node.accounts, members)
        ) {
            problems.push(
                `${group.name}: ${node.type}/${type}, ${node.groups.length}/${children.length} subgroups, ` +
                    `${node.accounts.length}/${members.length} accounts`
            );
        }
    }
    check(
        problems.length === 0,
        `every group's name, nature, parent, subgroups and accounts (archived too)` +
            (problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : '')
    );

    const grouped = accounts.filter(account => account.groups?.length);
    const ungrouped = accounts.filter(account => !account.groups?.length);
    const same = (node: SnapshotAccount | undefined, account: CliAccount) =>
        node !== undefined &&
        node.name === account.name &&
        node.type === account.type &&
        node.credit === (account.credit ?? false) &&
        node.permanent === (account.permanent ?? false) &&
        node.archived === (account.archived ?? false);
    check(
        sameSet(
            Object.keys(snapshot.accounts),
            grouped.map(account => account.id)
        ) && grouped.every(account => same(snapshot.accounts[account.id], account)),
        `${grouped.length} accounts in groups (${grouped.filter(a => a.archived).length} archived), with their names and natures`
    );
    check(
        sameSet(
            Object.keys(snapshot.ungrouped),
            ungrouped.map(account => account.id)
        ) && ungrouped.every(account => same(snapshot.ungrouped[account.id], account)),
        `${ungrouped.length} accounts in no group, with their names and natures`
    );
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const today = args.find(arg => arg.startsWith('--today='))?.slice('--today='.length);
    const bookIds = args.filter(arg => !arg.startsWith('--'));
    if (bookIds.length === 0 || (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today))) {
        console.error(
            'Usage: npx tsx scripts/verify-snapshot.ts [--today=YYYY-MM-DD] <bookId> [<bookId> ...]'
        );
        process.exit(2);
    }
    // Midday UTC is the same calendar day in every Book time zone within ±11 hours.
    const now = today ? () => new Date(`${today}T12:00:00Z`) : () => new Date();
    const token = cli(['auth', 'token']).trim();
    const bkper = new CountingBkper({ oauthTokenProvider: async () => token });
    for (const bookId of bookIds) {
        console.log(`Book ${bookId}`);
        await verifyBook(bkper, bookId, now);
    }
    console.log(failures === 0 ? 'All checks passed.' : `${failures} checks failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

await main();
