/**
 * Read-only check of the Book snapshot against live Books.
 *
 *     npx tsx scripts/verify-snapshot.ts [--today=YYYY-MM-DD] <bookId> [<bookId> ...]
 *
 * `--today` reads the Books as of an earlier day, so Books with old data also exercise the
 * current periods and their partial-month comparisons.
 *
 * For each Book it times cold loads (no cache) and a warm load, checks the snapshot tree
 * against `bkper group list` and `bkper account list`, and checks root and account amounts
 * against `bkper balance list --trial` for the last year with data, the current year to
 * date, and positions. Uses your `bkper auth token`; never writes to a Book.
 */
import { execFileSync } from 'node:child_process';
import { Amount, Bkper } from 'bkper-js';
import {
    addDays,
    previousPeriod,
    resolvePeriod,
    type DateRange,
} from '../server/src/services/periods.ts';
import {
    periodAmount,
    positionAmount,
    quote,
    type Snapshot,
    type SnapshotGroup,
    type SnapshotNode,
} from '../server/src/services/snapshot.ts';
import { loadSnapshot, type SnapshotStore } from '../server/src/services/snapshot-loader.ts';
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
    const timings: number[] = [];
    let snapshot: Snapshot | undefined;
    for (let i = 0; i < COLD_LOADS; i++) {
        const timing = new ServerTiming();
        const start = performance.now();
        snapshot = await loadSnapshot(bookId, { bkper, kv: new MemoryStore(), timing, now });
        const elapsed = performance.now() - start;
        timings.push(elapsed);
        console.log(`  cold load ${i + 1}: ${Math.round(elapsed)} ms (${timing.header()})`);
    }
    if (!snapshot) {
        return;
    }
    const store = new MemoryStore();
    await loadSnapshot(bookId, { bkper, kv: store, timing: new ServerTiming() });
    const warmTiming = new ServerTiming();
    const warmStart = performance.now();
    await loadSnapshot(bookId, { bkper, kv: store, timing: warmTiming });
    console.log(
        `  warm load: ${Math.round(performance.now() - warmStart)} ms (${warmTiming.header()})`
    );

    const sorted = [...timings].sort((a, b) => a - b);
    console.log(
        `  "${snapshot.book.name}": ${snapshot.roots.length} roots, ${Object.keys(snapshot.groups).length} groups, ` +
            `${Object.keys(snapshot.accounts).length} accounts, data ${snapshot.dataRange?.firstMonth}..${snapshot.dataRange?.lastMonth}, ` +
            `${Math.round(JSON.stringify(snapshot).length / 1024)} KiB; cold median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms`
    );

    verifyTree(bookId, snapshot);
    verifyAmounts(bookId, snapshot);
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
}

function verifyAmounts(bookId: string, snapshot: Snapshot): void {
    const context = { today: snapshot.today };
    const range = snapshot.dataRange;
    const years = range
        ? [...new Set([range.firstMonth, range.lastMonth].map(m => m.slice(0, 4)))]
        : [];
    const periods: [string, DateRange | undefined][] = [
        ...years.map((year): [string, DateRange | undefined] => [
            `year ${year}`,
            resolvePeriod(year, context),
        ]),
        ['this year to date', resolvePeriod('this_year', context)],
        ['this year, previous', previousPeriod('this_year', 'activity', context)],
        ['this month, previous', previousPeriod('this_month', 'activity', context)],
        ['this quarter, previous', previousPeriod('this_quarter', 'activity', context)],
        ['last 12 months, previous', previousPeriod('last_12_months', 'activity', context)],
    ];
    const positions = [
        ...years.map(year => `${Number(year) + 1}-01-01`),
        addDays(snapshot.today, 1),
    ];

    // A snapshot holds nothing dated after its today, unlike the live ledger.
    const tomorrow = addDays(snapshot.today, 1);
    const inSnapshot = (before: string) => before <= tomorrow;

    for (const id of snapshot.roots) {
        const root = snapshot.groups[id];
        if (root.permanent) {
            for (const before of positions.filter(inSnapshot)) {
                compare(bookId, snapshot, root, { before }, `position before ${before}`);
            }
            continue;
        }
        for (const [label, period] of periods) {
            if (period && inSnapshot(period.before)) {
                compare(bookId, snapshot, root, period, label);
            }
        }
    }
}

/** Compares a root and its accounts with `bkper balance list --trial`, shown with the credit-nature sign. */
function compare(
    bookId: string,
    snapshot: Snapshot,
    root: SnapshotGroup,
    range: DateRange,
    label: string
): void {
    const query = `group:${quote(root.name)}${range.after ? ` after:${range.after}` : ''} before:${range.before}`;
    const rows = JSON.parse(
        cli(['balance', 'list', '-b', bookId, '-q', query, '--trial', '--expanded', '1'])
    ) as (string | number)[][];
    const expected = new Map<string, Amount>();
    for (const [name, debit, credit] of rows.slice(1)) {
        expected.set(String(name).trim(), new Amount(String(credit)).minus(String(debit)));
    }
    const amount = (node: SnapshotNode) =>
        range.after === undefined
            ? positionAmount(node, range.before, snapshot)
            : periodAmount(node, range, snapshot);

    const nodes = [root, ...root.accounts.map(account => snapshot.accounts[account])];
    const mismatches: string[] = [];
    for (const node of nodes) {
        const raw = expected.get(node.name) ?? new Amount(0);
        const shown = node.credit ? raw : raw.times(-1);
        const actual = amount(node);
        if (!actual || !actual.eq(shown)) {
            mismatches.push(
                `${node.name}: snapshot ${actual?.toString()} vs CLI ${shown.toString()}`
            );
        }
    }
    check(
        mismatches.length === 0,
        `${root.name} ${label}: ${amount(root)?.toString()} (${nodes.length - 1} accounts)` +
            (mismatches.length ? ` — ${mismatches.slice(0, 3).join('; ')}` : '')
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
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    for (const bookId of bookIds) {
        console.log(`Book ${bookId}`);
        await verifyBook(bkper, bookId, now);
    }
    console.log(failures === 0 ? 'All checks passed.' : `${failures} checks failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

await main();
