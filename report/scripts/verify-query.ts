/**
 * Read-only check of reports of Bkper queries against the bkper CLI on live Books: a query is
 * read exactly as sent, so the report must show, to the cent, what Bkper answers that very query.
 *
 *     npx tsx scripts/verify-query.ts [--api=http://localhost:8809] <bookId> [<bookId> ...]
 *
 * For each Book it picks, from its map, an activity root group, a position root group, two
 * accounts and a subgroup under the activity root, and the last year before this one the
 * activity root moved in and its last month with movements (from the CLI), and writes queries the
 * way a Book writes them, its dates in the Book's date format: the year, the month and the
 * quarter of activity; days of that month, read as written; accounts and a subgroup side by
 * side; terms Bkper's balances ignore (amounts, `is:`, two hashtags); the same year with `on:` in
 * ISO; this whole year, through its last day (future-dated transactions included); a balance at
 * the end of that past year and at the end of this one; and a balance with no dates. Each goes to
 * the app as `POST /api/v1/books/{bookId}/report { query }` (default the local Worker, `npm run
 * dev:server`), which must answer with that very query as its `query` and `text`, and every
 * amount the report shows, each Answer and every breakdown row at any depth, must equal the
 * balance of its group or account the CLI lists for the same query, sent as is, to the cent;
 * every group or account the CLI lists with an amount must be shown. Known references of a Book
 * ({@link REFERENCES}) must be its headline exactly. A query of no group or account must answer
 * `query_not_a_report`.
 *
 * The CLI shows raw balances negated for permanent accounts; a CLI amount is flipped when its
 * row's `credit` equals its `permanent`, as reports show amounts as Bkper charts do. A query with
 * `after:` or `on:` lists activity in each column (summed), any other the running balance (the
 * last). Some accounts of older Books are not found by `account:'<name>'`, by Bkper and the CLI
 * alike; such a case is skipped and said. Uses your `bkper auth token`; never writes to a Book.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Amount, Bkper } from 'bkper-js';
import { quote, type Snapshot, type SnapshotNode } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const run = promisify(execFile);

/**
 * Headlines of queries of known Books, as Bkper's sidebar shows them: Bkper Finances has
 * transactions dated after today (amortization), which a report of the whole year includes.
 */
const REFERENCES: Record<string, { query: string; amount: string }[]> = {
    agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICAgKTP5LcJDA: [
        { query: "group:'Net Income' after:01/2026 before:01/2027", amount: '-3584.16' },
        { query: "group:'Bkper Balance Sheet' before:01/2027", amount: '-17669.04' },
    ],
};

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

type Matrix = (string | number)[][];

async function cliBalances(bookId: string, query: string): Promise<Matrix> {
    const { stdout } = await run(
        'bkper',
        ['balance', 'list', '-b', bookId, '-q', query, '--expanded', '10'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return JSON.parse(stdout) as Matrix;
}

/** The CLI's amount of each row by name: activity summed over its months, else the last. */
function cliTotals(matrix: Matrix, activity: boolean): Map<string, Amount> {
    const [header = [], ...lines] = matrix;
    const columns = header
        .map((cell, index) => ({ cell: String(cell), index }))
        .filter(({ cell }) => /^\d{4}-\d{2}-\d{2}$/.test(cell))
        .map(({ index }) => index);
    const totals = new Map<string, Amount>();
    for (const line of lines) {
        const values = columns.map(index => new Amount(String(line[index] ?? 0)));
        const total = activity
            ? values.reduce((sum, value) => sum.plus(value), new Amount(0))
            : (values.at(-1) ?? new Amount(0));
        totals.set(String(line[0]).trim(), total);
    }
    return totals;
}

/** A day written in the Book's date format. */
function written(day: string, pattern: string | undefined): string {
    const [year, month, date] = day.split('-');
    switch (pattern) {
        case 'MM/dd/yyyy':
            return `${month}/${date}/${year}`;
        case 'yyyy/MM/dd':
            return `${year}/${month}/${date}`;
        default:
            return `${date}/${month}/${year}`;
    }
}

function monthStart(year: number, month: number): string {
    const index = year * 12 + month - 1;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

interface Case {
    name: string;
    /** The query sent to the app, and to the CLI as is. */
    query: string;
}

/** Whether the CLI lists a query's activity by column, rather than its running balance. */
function listsActivity(query: string): boolean {
    return /(^|[\s(])(after|on):/i.test(query);
}

/** Accounts with transactions under a group, at any depth, in the map's order. */
function postedAccounts(snapshot: Snapshot, groupId: string): string[] {
    const group = snapshot.groups[groupId];
    return [
        ...group.accounts.filter(id => {
            const account = snapshot.accounts[id];
            return account?.posted && !account.archived;
        }),
        ...group.groups.flatMap(id => postedAccounts(snapshot, id)),
    ];
}

/** A root group of one nature, with accounts with transactions, mixing none. */
function rootOf(snapshot: Snapshot, permanent: boolean): string | undefined {
    return snapshot.roots.find(id => {
        const group = snapshot.groups[id];
        const accounts = postedAccounts(snapshot, id);
        return (
            group.permanent === permanent &&
            !group.hidden &&
            accounts.length > 0 &&
            accounts.every(account => snapshot.accounts[account].permanent === permanent)
        );
    });
}

/** The last year before this one the group moved in, and its last month with movements, by the CLI. */
async function lastMoved(
    bookId: string,
    group: string,
    today: string
): Promise<{ year: number; month: number } | undefined> {
    const nextYear = Number(today.slice(0, 4)) + 1;
    const lastNonZero = (matrix: Matrix): string | undefined => {
        const [header = [], row] = matrix;
        let found: string | undefined;
        header.forEach((cell, index) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(cell)) && Number(row?.[index] ?? 0) !== 0) {
                found = String(cell);
            }
        });
        return found;
    };
    const years = lastNonZero(
        await cliBalances(
            bookId,
            `group:${quote(group)} after:1990-01-01 before:${nextYear}-01-01 by:y`
        )
    );
    if (!years) {
        return undefined;
    }
    // A past year: this one is a case of its own.
    const year = Math.min(Number(years.slice(0, 4)), Number(today.slice(0, 4)) - 1);
    const months = lastNonZero(
        await cliBalances(
            bookId,
            `group:${quote(group)} after:${year}-01-01 before:${year + 1}-01-01 by:m`
        )
    );
    return { year, month: Number(months?.slice(5, 7) ?? 12) };
}

async function casesOf(bookId: string, snapshot: Snapshot): Promise<Case[]> {
    const pattern = snapshot.book.datePattern;
    const d = (day: string) => written(day, pattern);
    const range = (from: string, to: string) => `after:${d(from)} before:${d(to)}`;
    const cases: Case[] = [];
    const add = (name: string, query: string) => cases.push({ name, query });
    const thisYear = Number(snapshot.today.slice(0, 4));
    const activity = rootOf(snapshot, false);
    const position = rootOf(snapshot, true);
    const positionGroup = position && `group:${quote(snapshot.groups[position].name)}`;
    if (activity) {
        const name = snapshot.groups[activity].name;
        const group = `group:${quote(name)}`;
        const moved = await lastMoved(bookId, name, snapshot.today);
        if (moved) {
            const { year, month } = moved;
            const quarter = month - ((month - 1) % 3);
            const yearRange = range(monthStart(year, 1), monthStart(year + 1, 1));
            add('activity, a year', `${group} ${yearRange}`);
            add(
                'activity, a month',
                `${group} ${range(monthStart(year, month), monthStart(year, month + 1))}`
            );
            add(
                'activity, a quarter',
                `${group} ${range(monthStart(year, quarter), monthStart(year, quarter + 3))}`
            );
            add(
                'activity, days of a month, as written',
                `${group} ${range(
                    monthStart(year, month).replace(/01$/, '10'),
                    monthStart(year, month).replace(/01$/, '20')
                )}`
            );
            add('activity, ignored terms', `${group} ${yearRange} amount>0 is:posted #a #b text`);
            add('activity, a year in ISO', `${group} on:${year}`);
            const accounts = postedAccounts(snapshot, activity).slice(0, 2);
            if (accounts.length > 0) {
                add(
                    'activity, accounts side by side',
                    `${accounts.map(id => `account:${quote(snapshot.accounts[id].name)}`).join(' ')} ${yearRange}`
                );
            }
            const [subgroup] = snapshot.groups[activity].groups;
            if (subgroup) {
                add(
                    'activity, a subgroup',
                    `group:${quote(snapshot.groups[subgroup].name)} ${yearRange}`
                );
            }
            if (positionGroup) {
                add(
                    'position, the end of a past year',
                    `${positionGroup} before:${d(monthStart(year + 1, 1))}`
                );
            }
        }
        // The whole of this year, future-dated transactions and all.
        add(
            'activity, this whole year',
            `${group} ${range(monthStart(thisYear, 1), monthStart(thisYear + 1, 1))}`
        );
    }
    if (positionGroup) {
        add(
            'position, the end of this year',
            `${positionGroup} before:${d(monthStart(thisYear + 1, 1))}`
        );
        add('position, no dates', positionGroup);
    }
    for (const reference of REFERENCES[bookId] ?? []) {
        add('reference', reference.query);
    }
    return cases;
}

let checks = 0;
let failures = 0;

function check(ok: boolean, message: string): void {
    checks++;
    if (!ok) {
        failures++;
        console.log(`    ✗ ${message}`);
    }
}

/** Whether a report's amount is the CLI's, at the precision the CLI prints. */
function isCliAmount(actual: string, expected: Amount): boolean {
    const amount = new Amount(actual);
    return amount.eq(expected) || amount.toNumber() === expected.toNumber();
}

interface SpecElement {
    type: string;
    props: Record<string, unknown>;
}

interface Row {
    label: string;
    amount: string;
    children: Row[];
}

/** Every amount a report shows, by the name of its group or account. */
function shownAmounts(elements: Record<string, SpecElement>): { label: string; amount: string }[] {
    const shown: { label: string; amount: string }[] = [];
    const visit = (rows: Row[]) =>
        rows.forEach(row => {
            shown.push({ label: row.label, amount: row.amount });
            visit(row.children);
        });
    for (const element of Object.values(elements)) {
        if (element.type === 'Answer') {
            shown.push({
                label: String(element.props.label),
                amount: String(element.props.amount),
            });
        }
        if (element.type === 'BreakdownTable') {
            visit(element.props.rows as Row[]);
        }
    }
    return shown;
}

async function verifyCase(
    api: string,
    token: string,
    bookId: string,
    snapshot: Snapshot,
    test: Case
): Promise<void> {
    const response = await fetch(`${api}/api/v1/books/${bookId}/report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: test.query, language: 'en' }),
    });
    const body = (await response.json()) as {
        query?: string;
        text?: string;
        spec?: { elements: Record<string, SpecElement> };
        error?: { code: string };
    };
    console.log(`  ${test.name}: ${test.query}`);
    if (!response.ok || !body.spec) {
        check(false, `answered ${response.status} ${body.error?.code ?? ''}`);
        return;
    }
    check(
        body.query === test.query && body.text === test.query,
        `read as ${body.query}, its text ${body.text}`
    );
    const totals = cliTotals(await cliBalances(bookId, test.query), listsActivity(test.query));
    if (totals.size === 0) {
        console.log(
            '    skipped: the CLI lists nothing for it (an account Bkper does not find by name)'
        );
        return;
    }
    const nodes = new Map<string, SnapshotNode>();
    for (const node of [
        ...Object.values(snapshot.accounts),
        ...Object.values(snapshot.ungrouped),
        ...Object.values(snapshot.groups),
    ]) {
        nodes.set(node.name, node);
    }
    const shown = shownAmounts(body.spec.elements);
    const reference = (REFERENCES[bookId] ?? []).find(({ query }) => query === test.query);
    if (reference) {
        const headline = shown[0]?.amount;
        check(
            headline !== undefined && new Amount(headline).eq(reference.amount),
            `the headline is ${headline}, Bkper's sidebar ${reference.amount}`
        );
    }
    for (const { label, amount } of shown) {
        const cli = totals.get(label);
        const node = nodes.get(label);
        if (!cli || !node) {
            check(new Amount(amount).eq(0), `${label}: ${amount}, which the CLI does not list`);
            continue;
        }
        const expected = node.credit === node.permanent ? cli.times(-1) : cli;
        check(isCliAmount(amount, expected), `${label}: ${amount}, the CLI ${expected.toString()}`);
    }
    const labels = new Set(shown.map(({ label }) => label));
    for (const [name, amount] of totals) {
        check(
            !amount.eq(0) ? labels.has(name) : true,
            `${name}: the CLI lists ${amount.toString()}, not shown`
        );
    }
    console.log(`    ${shown.length} amounts`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const api = args.find(arg => arg.startsWith('--api='))?.slice(6) ?? 'http://localhost:8809';
    const bookIds = args.filter(arg => !arg.startsWith('--'));
    if (bookIds.length === 0) {
        console.error(
            'Usage: npx tsx scripts/verify-query.ts [--api=<url>] <bookId> [<bookId> ...]'
        );
        process.exit(2);
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    for (const bookId of bookIds) {
        const timing = new ServerTiming();
        const snapshot = await loadSnapshot(bookId, {
            userId: await currentUserId(bkper, timing),
            bkper,
            kv: new MemoryStore(),
            timing,
        });
        console.log(
            `${snapshot.book.name} (${snapshot.book.datePattern}, today ${snapshot.today})`
        );
        for (const test of await casesOf(bookId, snapshot)) {
            await verifyCase(api, token, bookId, snapshot, test);
        }
        const refused = await fetch(`${api}/api/v1/books/${bookId}/report`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'is:checked amount>10' }),
        });
        const refusal = (await refused.json()) as { error?: { code: string } };
        check(
            refused.status === 422 && refusal.error?.code === 'query_not_a_report',
            `a query of no group or account answered ${refused.status} ${refusal.error?.code}`
        );
    }
    console.log(
        failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} checks failed.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
