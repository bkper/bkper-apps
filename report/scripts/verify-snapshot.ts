/**
 * Read-only check of the Book snapshot against live Books.
 *
 *     npx tsx scripts/verify-snapshot.ts [--today=YYYY-MM-DD] <bookId> [<bookId> ...]
 *
 * `--today` reads the Books as of an earlier day, as the snapshot of that day holds them.
 *
 * The snapshot is the Book's map: it holds no amounts. For each Book it times cold loads (no
 * cache) and a warm load, checks the snapshot tree against `bkper group list` and
 * `bkper account list` (and the accounts in no group, with their type, against the accounts
 * the CLI lists without groups), and checks the months each group and account had movements in against
 * `bkper balance list` by month: every month with a balance in the CLI is one, and each is a
 * month the CLI lists (a month whose movements net to zero shows zero there). Uses your
 * `bkper auth token`; never writes to a Book.
 */
import { execFileSync } from 'node:child_process';
import { Amount, Bkper } from 'bkper-js';
import { addDays, isPlausibleYear } from '../server/src/services/periods.ts';
import {
    quote,
    type Snapshot,
    type SnapshotGroup,
    type SnapshotNode,
} from '../server/src/services/snapshot.ts';
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
    parent?: { id: string };
}

interface CliAccount {
    id: string;
    name: string;
    type?: string;
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

async function verifyBook(bkper: Bkper, bookId: string, now: () => Date): Promise<void> {
    const userId = await currentUserId(bkper, new ServerTiming());
    const timings: number[] = [];
    let snapshot: Snapshot | undefined;
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
    const store = new MemoryStore();
    await loadSnapshot(bookId, { userId, bkper, kv: store, timing: new ServerTiming() });
    const warmTiming = new ServerTiming();
    const warmStart = performance.now();
    await loadSnapshot(bookId, { userId, bkper, kv: store, timing: warmTiming });
    console.log(
        `  warm load: ${Math.round(performance.now() - warmStart)} ms (${warmTiming.header()})`
    );

    const sorted = [...timings].sort((a, b) => a - b);
    console.log(
        `  "${snapshot.book.name}": ${snapshot.roots.length} roots, ${Object.keys(snapshot.groups).length} groups, ` +
            `${Object.keys(snapshot.accounts).length} accounts, ` +
            `${Object.keys(snapshot.ungrouped).length} in no group, data ${snapshot.dataRange?.firstMonth}..${snapshot.dataRange?.lastMonth}, ` +
            `${Math.round(JSON.stringify(snapshot).length / 1024)} KiB; cold median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms`
    );

    verifyTree(bookId, snapshot);
    verifyActiveMonths(bookId, snapshot);
}

function verifyTree(bookId: string, snapshot: Snapshot): void {
    const groups = (JSON.parse(cli(['group', 'list', '-b', bookId])) as { items: CliGroup[] })
        .items;
    const accounts = (JSON.parse(cli(['account', 'list', '-b', bookId])) as { items: CliAccount[] })
        .items;
    const sameSet = (a: string[], b: string[]) =>
        a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

    const roots = groups.filter(group => !group.parent).map(group => group.id);
    check(sameSet(snapshot.roots, roots), `roots match bkper group list (${roots.length})`);
    for (const group of groups) {
        const node = snapshot.groups[group.id];
        if (!node) {
            check(false, `group ${group.name} is in the snapshot`);
            continue;
        }
        const children = groups.filter(g => g.parent?.id === group.id).map(g => g.id);
        const members = accounts.filter(account => account.groups?.some(g => g.id === group.id));
        // Bkper leaves archived accounts with no balance today out of the balances.
        const listed = members.filter(account => node.accounts.includes(account.id));
        const leftOut = members.filter(account => !node.accounts.includes(account.id));
        const type = group.mixed ? 'MIXED' : group.type;
        check(
            node.name === group.name &&
                node.type === type &&
                node.parent === group.parent?.id &&
                sameSet(node.groups, children) &&
                sameSet(
                    node.accounts,
                    listed.map(account => account.id)
                ) &&
                leftOut.every(account => account.archived),
            `group ${group.name}: ${type}, ${children.length} subgroups, ${listed.length} accounts` +
                (leftOut.length ? ` (+${leftOut.length} archived left out by Bkper)` : '')
        );
    }
    const ungrouped = accounts.filter(account => !account.groups?.length);
    check(
        sameSet(
            Object.keys(snapshot.ungrouped),
            ungrouped.map(account => account.id)
        ) &&
            ungrouped.every(account => {
                const node = snapshot.ungrouped[account.id];
                return (
                    node.name === account.name &&
                    node.type === account.type &&
                    node.archived === (account.archived ?? false)
                );
            }),
        `${ungrouped.length} accounts in no group, with their names, types and archived flags`
    );
}

/** Checks each root's groups' and accounts' months with movements against the CLI by month. */
function verifyActiveMonths(bookId: string, snapshot: Snapshot): void {
    for (const id of snapshot.roots) {
        const root = snapshot.groups[id];
        // The CLI lists activity in each month of a query with `after:`.
        const query = `group:${quote(root.name)} after:1000-01-01 before:${addDays(snapshot.today, 1)} by:m`;
        const [header = [], ...lines] = JSON.parse(
            cli(['balance', 'list', '-b', bookId, '-q', query, '--expanded', '10'])
        ) as (string | number)[][];
        const columns = header
            .map((cell, index) => ({ month: String(cell).slice(0, 7), index }))
            .filter(({ month }) => /^\d{4}-\d{2}$/.test(month));
        const listed = new Set(columns.map(column => column.month));
        const moved = new Map<string, Set<string>>();
        for (const line of lines) {
            moved.set(
                String(line[0]).trim(),
                new Set(
                    columns
                        .filter(({ index }) => !new Amount(String(line[index] ?? 0)).eq(0))
                        .map(column => column.month)
                )
            );
        }
        const nodes = subtree(snapshot, root);
        const problems: string[] = [];
        let netZero = 0;
        for (const node of nodes) {
            const active = new Set(
                node.activeMonths.filter(month => isPlausibleYear(Number(month.slice(0, 4))))
            );
            const missing = [...(moved.get(node.name) ?? [])].filter(month => !active.has(month));
            const unlisted = [...active].filter(month => !listed.has(month));
            netZero += [...active].filter(month => !moved.get(node.name)?.has(month)).length;
            if (missing.length || unlisted.length) {
                problems.push(
                    `${node.name}: ${missing.length ? `misses ${missing.slice(0, 3).join(', ')}` : ''}` +
                        `${unlisted.length ? ` has ${unlisted.slice(0, 3).join(', ')} the CLI does not list` : ''}`
                );
            }
        }
        check(
            problems.length === 0,
            `${root.name}: months with movements of ${nodes.length} groups and accounts, last ${root.activeMonths.at(-1) ?? 'none'}` +
                (netZero ? ` (${netZero} netting to zero)` : '') +
                (problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : '')
        );
    }
}

/** A group and every group and account under it. */
function subtree(snapshot: Snapshot, group: SnapshotGroup): SnapshotNode[] {
    return [
        group,
        ...group.accounts.map(id => snapshot.accounts[id]),
        ...group.groups.flatMap(id => subtree(snapshot, snapshot.groups[id])),
    ];
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
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    for (const bookId of bookIds) {
        console.log(`Book ${bookId}`);
        await verifyBook(bkper, bookId, now);
    }
    console.log(failures === 0 ? 'All checks passed.' : `${failures} checks failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

await main();
