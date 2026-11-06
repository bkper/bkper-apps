/**
 * Read-only cross-check of report calculations against the bkper CLI on live Books.
 *
 *     npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId> [<bookId> ...]
 *
 * For each Book it loads the snapshot (as of `--today`, when given, so Books with old data also
 * exercise current periods and today's activity), builds reports for several intents within the
 * Book's data range, runs the one live query a report asks for, and compares to the cent with
 * `bkper balance list` over the report's exact query and its previous period:
 *
 * - the answer, and Incoming and Outgoing for a net result over the unique accounts, both in
 *   the answer and in the breakdown's Incoming and Outgoing rows;
 * - every group and account row of the breakdown, in the root's sense (for a net result, in
 *   its side's sense: Outgoing positive);
 * - each month of the root, or of Incoming, Outgoing and the net result, for reports over
 *   several months;
 * - that every breakdown, remainder included, adds up to its parent, and that a net result is
 *   Incoming minus Outgoing, in total, in the previous period and in every month;
 * - that charts draw no row without an amount.
 *
 * The CLI shows raw balances (credit minus debit), negated for permanent accounts, so Liability
 * and Outgoing come out negative; reports show them as Bkper charts do, by credit nature. A CLI
 * amount is flipped when its row's `credit` equals its `permanent`. Uses your `bkper auth token`;
 * never writes to a Book.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Amount, Bkper, type Book } from 'bkper-js';
import { readLiveBalances } from '../server/src/services/live-balances.ts';
import type { DateRange } from '../server/src/services/periods.ts';
import { buildReport, type ReportData, type ReportRow } from '../server/src/services/report.ts';
import { NET_RESULT_ROOT, type ReportIntent } from '../server/src/services/report-intent.ts';
import type { Snapshot, SnapshotNode } from '../server/src/services/snapshot.ts';
import { loadSnapshot, type SnapshotStore } from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const CLI_CONCURRENCY = 6;
const run = promisify(execFile);

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

/** Runs CLI commands a few at a time. */
class Cli {
    private active = 0;
    private readonly waiting: (() => void)[] = [];

    async balances(bookId: string, query: string): Promise<(string | number)[][]> {
        if (this.active >= CLI_CONCURRENCY) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
        }
        this.active++;
        try {
            const { stdout } = await run(
                'bkper',
                ['balance', 'list', '-b', bookId, '-q', query, '--expanded', '10'],
                { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
            );
            return JSON.parse(stdout) as (string | number)[][];
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}

/**
 * One CLI table: amounts by row name, in total and by month. Like the CLI, a query with
 * `after:` lists activity in each month, and any other query the running total at each month.
 */
interface CliRow {
    name: string;
    total: Amount;
    months: Map<string, Amount>;
}

function cliRows(matrix: (string | number)[][], cumulative: boolean): Map<string, CliRow[]> {
    const [header = [], ...lines] = matrix;
    const dates = header
        .map((cell, index) => ({ cell: String(cell), index }))
        .filter(({ cell }) => /^\d{4}-\d{2}-\d{2}$/.test(cell));
    const rows = new Map<string, CliRow[]>();
    for (const line of lines) {
        const name = String(line[0]).trim();
        const months = new Map<string, Amount>();
        let total = new Amount(0);
        for (const { cell, index } of dates) {
            const value = new Amount(String(line[index] ?? 0));
            const month = cell.slice(0, 7);
            months.set(
                month,
                cumulative ? value : (months.get(month) ?? new Amount(0)).plus(value)
            );
            total = cumulative ? value : total.plus(value);
        }
        rows.set(name, [...(rows.get(name) ?? []), { name, total, months }]);
    }
    return rows;
}

/** A CLI amount in the sign reports show for the node. */
function shown(node: SnapshotNode, cli: Amount): Amount {
    return node.credit === node.permanent ? cli.times(-1) : cli;
}

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
    checks++;
    if (!ok) {
        failures++;
    }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

function intentsFor(snapshot: Snapshot, hashtags: string[]): ReportIntent[] {
    const range = snapshot.dataRange;
    if (!range) {
        return [];
    }
    const firstYear = range.firstMonth.slice(0, 4);
    const lastYear = range.lastMonth.slice(0, 4);
    const quarter = `${lastYear}-Q${Math.ceil(Number(range.lastMonth.slice(5)) / 3)}`;
    const roots = [...snapshot.roots, NET_RESULT_ROOT];
    const intents: ReportIntent[] = roots.flatMap(root => [
        { root, period: firstYear, monthly: false },
        { root, period: lastYear, monthly: true },
        { root, period: quarter, monthly: false },
        { root, period: range.lastMonth, monthly: false },
        { root, period: 'this_month', monthly: false },
        { root, period: 'today', monthly: false },
    ]);
    for (const hashtag of hashtags) {
        for (const root of roots) {
            intents.push({ root, period: 'all', monthly: false, hashtags: [hashtag] });
            intents.push({ root, period: lastYear, monthly: true, hashtags: [hashtag] });
        }
    }
    return intents;
}

async function computeReport(
    intent: ReportIntent,
    snapshot: Snapshot,
    book: Book
): Promise<{ report: ReportData; computeMs: number; liveMs?: number }> {
    let start = performance.now();
    let step = buildReport(intent, snapshot);
    let computeMs = performance.now() - start;
    if ('report' in step) {
        return { report: step.report, computeMs };
    }
    const query = step.liveQuery;
    start = performance.now();
    const result = await book.getBalancesReport(query.query);
    const liveMs = performance.now() - start;
    start = performance.now();
    step = buildReport(intent, snapshot, readLiveBalances(query, result, snapshot, new Date()));
    computeMs += performance.now() - start;
    if (!('report' in step)) {
        throw new Error(`A second live query was asked for: ${step.liveQuery.query}`);
    }
    return { report: step.report, computeMs, liveMs };
}

function withDates(report: ReportData, range: DateRange): string {
    const filter = report.query.replace(/ (after:\S+ )?before:\S+$/, '');
    return report.nature === 'position' || range.after === undefined
        ? `${filter} before:${range.before}`
        : `${filter} after:${range.after} before:${range.before}`;
}

async function verifyReport(
    cli: Cli,
    bookId: string,
    snapshot: Snapshot,
    report: ReportData,
    label: string
): Promise<void> {
    const read = async (query: string) =>
        cliRows(await cli.balances(bookId, query), !query.includes('after:'));
    const cumulative = !report.query.includes('after:');
    const [current, previous] = await Promise.all([
        read(report.query),
        report.previous ? read(withDates(report, report.previous)) : Promise.resolve(undefined),
    ]);
    const problems: string[] = [];
    const same = (what: string, actual: string | undefined, expected: Amount) => {
        if (actual === undefined || !new Amount(actual).eq(expected)) {
            problems.push(`${what}: report ${actual} vs CLI ${expected.toFixed()}`);
        }
    };
    const cliTotal = (rows: Map<string, CliRow[]> | undefined, node: SnapshotNode) =>
        shown(node, rows?.get(node.name)?.[0]?.total ?? new Amount(0));

    if (report.root.id === NET_RESULT_ROOT) {
        // Sums the CLI amounts of the Book's Incoming and Outgoing accounts, in total or in a month.
        const sides = (
            rows: Map<string, CliRow[]> | undefined,
            pick: (row: CliRow) => Amount | undefined = row => row.total
        ) => {
            let incoming = new Amount(0);
            let outgoing = new Amount(0);
            for (const account of Object.values(snapshot.accounts)) {
                const row = rows?.get(account.name)?.[0];
                if (!row) {
                    continue;
                }
                const amount = shown(account, pick(row) ?? new Amount(0));
                if (account.type === 'INCOMING') {
                    incoming = incoming.plus(amount);
                } else if (account.type === 'OUTGOING') {
                    outgoing = outgoing.plus(amount);
                }
            }
            return { incoming, outgoing, net: incoming.minus(outgoing) };
        };
        const incomingRow = report.breakdown.find(row => row.kind === 'incoming');
        const outgoingRow = report.breakdown.find(row => row.kind === 'outgoing');
        const now = sides(current);
        same('incoming', report.net?.incoming.amount, now.incoming);
        same('outgoing', report.net?.outgoing.amount, now.outgoing);
        same('net', report.answer.amount, now.net);
        // Rows without amounts are left out, so a missing side must be zero.
        same('incoming row', incomingRow?.amount ?? '0', now.incoming);
        same('outgoing row', outgoingRow?.amount ?? '0', now.outgoing);
        if (previous) {
            const before = sides(previous);
            same('previous incoming', report.net?.incoming.previous, before.incoming);
            same('previous outgoing', report.net?.outgoing.previous, before.outgoing);
            same('previous net', report.answer.previous, before.net);
            same('previous incoming row', incomingRow?.previous ?? '0', before.incoming);
            same('previous outgoing row', outgoingRow?.previous ?? '0', before.outgoing);
        }
        // Every account of a side, in the side's sense, as Bkper shows it.
        for (const row of [incomingRow, outgoingRow].flatMap(side => side?.children ?? [])) {
            const account = snapshot.accounts[row.id];
            if (!account) {
                problems.push(`${row.name ?? row.id}: not an account of the Book`);
                continue;
            }
            same(row.name ?? row.id, row.amount, cliTotal(current, account));
            if (previous) {
                same(`${row.name} previous`, row.previous, cliTotal(previous, account));
            }
        }
        if (report.months.length > 1 && !cumulative) {
            report.months.forEach((month, i) => {
                const cli = sides(current, row => row.months.get(month));
                same(`incoming ${month}`, incomingRow?.months[i] ?? '0', cli.incoming);
                same(`outgoing ${month}`, outgoingRow?.months[i] ?? '0', cli.outgoing);
                same(`net ${month}`, report.net?.months[i], cli.net);
            });
        }
    } else {
        const root = snapshot.groups[report.root.id];
        same('answer', report.answer.amount, cliTotal(current, root));
        if (previous) {
            same('previous', report.answer.previous, cliTotal(previous, root));
        }
        const visit = (row: ReportRow) => {
            const node =
                row.kind === 'group'
                    ? snapshot.groups[row.id]
                    : row.kind === 'account'
                      ? snapshot.accounts[row.id]
                      : undefined;
            if (node) {
                const sign = node.credit === root.credit ? 1 : -1;
                same(row.name ?? row.id, row.amount, cliTotal(current, node).times(sign));
                if (previous) {
                    same(
                        `${row.name} previous`,
                        row.previous,
                        cliTotal(previous, node).times(sign)
                    );
                }
            }
            row.children.forEach(visit);
        };
        report.breakdown.forEach(visit);
        // Activity by month needs a CLI table of activity, not of running totals.
        if (report.months.length > 1 && (report.nature === 'position' || !cumulative)) {
            const months = current.get(root.name)?.[0]?.months ?? new Map<string, Amount>();
            const series = cliSeries(report, months, cumulative);
            report.months.forEach((month, i) => {
                const amount =
                    report.chart.kind === 'bar' || report.chart.kind === 'line'
                        ? report.chart.series[0].amounts[i]
                        : undefined;
                const expected = series.get(month);
                if (amount !== undefined && expected !== undefined) {
                    same(`month ${month}`, amount, shown(root, expected));
                }
            });
        }
    }
    problems.push(...unbalanced(report));

    const rowCount = countRows(report.breakdown);
    const remainders = countRows(report.breakdown, row => row.kind === 'other');
    check(
        problems.length === 0,
        `${label}: ${report.answer.amount}` +
            (report.answer.previous === undefined ? '' : ` (prev ${report.answer.previous})`) +
            `, ${rowCount} rows${remainders ? ` (${remainders} remainder)` : ''} — ${report.query}` +
            (problems.length ? `\n         ${problems.slice(0, 4).join('\n         ')}` : '')
    );
}

/** CLI amounts by month of the report: activity in each month, or the position at its end. */
function cliSeries(
    report: ReportData,
    months: Map<string, Amount>,
    cumulative: boolean
): Map<string, Amount> {
    if (!cumulative) {
        return new Map(report.months.map(month => [month, months.get(month) ?? new Amount(0)]));
    }
    // The CLI lists positions only for months with movements; a position carries forward.
    const series = new Map<string, Amount>();
    let last: Amount | undefined;
    const known = [...months.keys()].sort();
    for (const month of report.months) {
        for (const key of known.filter(key => key <= month)) {
            last = months.get(key);
        }
        if (last !== undefined) {
            series.set(month, last);
        }
    }
    return series;
}

/** Rows whose children (remainder included) do not add up to them. */
function unbalanced(report: ReportData): string[] {
    const problems: string[] = [];
    const total = (rows: ReportRow[], pick: (row: ReportRow) => string | undefined) =>
        rows.reduce((sum, row) => sum.plus(pick(row) ?? 0), new Amount(0));
    const checkRows = (
        name: string,
        amount: string,
        previous: string | undefined,
        rows: ReportRow[]
    ) => {
        if (rows.length === 0) {
            return;
        }
        if (!total(rows, row => row.amount).eq(amount)) {
            problems.push(`${name}: children do not add up to ${amount}`);
        }
        if (previous !== undefined && !total(rows, row => row.previous).eq(previous)) {
            problems.push(`${name}: children do not add up to previous ${previous}`);
        }
        for (const row of rows) {
            checkRows(row.name ?? row.id, row.amount, row.previous, row.children);
        }
    };
    const side = (id: string) =>
        report.breakdown.find(row => row.kind === id && (id === 'incoming' || id === 'outgoing'));
    if (report.root.id !== NET_RESULT_ROOT) {
        checkRows('answer', report.answer.amount, report.answer.previous, report.breakdown);
    } else {
        // Incoming minus Outgoing is the net result, in total, before and in every month.
        const zero = { amount: '0', previous: '0', months: report.months.map(() => '0') };
        const incoming = side('incoming') ?? zero;
        const outgoing = side('outgoing') ?? zero;
        const net = (a?: string, b?: string) => new Amount(a ?? 0).minus(b ?? 0);
        if (!net(incoming.amount, outgoing.amount).eq(report.answer.amount)) {
            problems.push(`Incoming - Outgoing is not the net result ${report.answer.amount}`);
        }
        if (
            report.answer.previous !== undefined &&
            !net(incoming.previous, outgoing.previous).eq(report.answer.previous)
        ) {
            problems.push(`Incoming - Outgoing is not the previous net ${report.answer.previous}`);
        }
        if (report.net?.months.length !== report.months.length) {
            problems.push('The net result does not have one amount per month');
        }
        report.months.forEach((month, i) => {
            const expected = net(incoming.months[i], outgoing.months[i]);
            if (!expected.eq(report.net?.months[i] ?? 'NaN')) {
                problems.push(`Incoming - Outgoing is not the net result in ${month}`);
            }
        });
        for (const row of report.breakdown) {
            if (row.kind !== 'incoming' && row.kind !== 'outgoing') {
                problems.push(`${row.id}: not a side of the net result`);
            }
            checkRows(row.id, row.amount, row.previous, row.children);
        }
        if (report.chart.kind === 'bar') {
            for (const series of report.chart.series) {
                const expected =
                    series.id === NET_RESULT_ROOT ? report.net?.months : side(series.id)?.months;
                if (series.amounts.join() !== expected?.join()) {
                    problems.push(`The chart's ${series.id} is not the table's`);
                }
            }
        }
    }
    // Charts draw only rows with an amount.
    if (report.chart.kind === 'ranked-bar' || report.chart.kind === 'donut') {
        for (const id of report.chart.rows) {
            const row = report.breakdown.find(candidate => candidate.id === id);
            if (!row || new Amount(row.amount).eq(0)) {
                problems.push(`The chart draws ${id}, a row without an amount`);
            }
        }
    }
    if (report.chart.kind === 'bar' && report.root.id === NET_RESULT_ROOT) {
        for (const series of report.chart.series.filter(entry => entry.id !== NET_RESULT_ROOT)) {
            if (new Amount(side(series.id)?.amount ?? 0).eq(0)) {
                problems.push(`The chart draws ${series.id}, a side without an amount`);
            }
        }
    }
    return problems;
}

function countRows(rows: ReportRow[], include: (row: ReportRow) => boolean = () => true): number {
    return rows.reduce(
        (count, row) => count + Number(include(row)) + countRows(row.children, include),
        0
    );
}

async function verifyBook(
    bkper: Bkper,
    cli: Cli,
    bookId: string,
    now: () => Date,
    hashtags: string[]
): Promise<void> {
    const snapshot = await loadSnapshot(bookId, {
        bkper,
        kv: new MemoryStore(),
        timing: new ServerTiming(),
        now,
    });
    const book = await bkper.getBook(bookId);
    console.log(
        `Book "${snapshot.book.name}" today ${snapshot.today}, data ${snapshot.dataRange?.firstMonth}..${snapshot.dataRange?.lastMonth}`
    );
    const liveTimes: number[] = [];
    const computeTimes: number[] = [];
    const reports: { label: string; report: ReportData }[] = [];
    // One at a time, so the times are of the calculation alone.
    for (const intent of intentsFor(snapshot, hashtags)) {
        const label =
            `${snapshot.groups[intent.root]?.name ?? intent.root} ${intent.period}` +
            (intent.monthly ? ' monthly' : '') +
            (intent.hashtags ? ` #${intent.hashtags.join(' #')}` : '');
        try {
            const { report, computeMs, liveMs } = await computeReport(intent, snapshot, book);
            computeTimes.push(computeMs);
            if (liveMs !== undefined) {
                liveTimes.push(liveMs);
            }
            reports.push({ label: label + (liveMs === undefined ? '' : ' [live]'), report });
        } catch (error) {
            check(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    await Promise.all(
        reports.map(({ label, report }) => verifyReport(cli, bookId, snapshot, report, label))
    );
    const median = (values: number[]) =>
        values.length
            ? Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)])
            : 0;
    const max = (values: number[]) => Math.round(Math.max(0, ...values) * 10) / 10;
    console.log(
        `  ${reports.length} reports; compute median ${median(computeTimes)} ms, max ${max(computeTimes)} ms; ` +
            `${liveTimes.length} live queries, median ${median(liveTimes)} ms, max ${Math.round(max(liveTimes))} ms`
    );
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const option = (name: string) =>
        args.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
    const [today] = option('today');
    const hashtags = option('hashtag');
    const bookIds = args.filter(arg => !arg.startsWith('--'));
    if (bookIds.length === 0 || (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today))) {
        console.error(
            'Usage: npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId> [<bookId> ...]'
        );
        process.exit(2);
    }
    // Midday UTC is the same calendar day in every Book time zone within ±11 hours.
    const now = today ? () => new Date(`${today}T12:00:00Z`) : () => new Date();
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const cli = new Cli();
    for (const bookId of bookIds) {
        await verifyBook(bkper, cli, bookId, now, hashtags);
    }
    console.log(
        failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} checks failed.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
