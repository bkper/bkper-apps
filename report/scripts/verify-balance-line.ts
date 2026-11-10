/**
 * Read-only check of the line of a balance as of a day against the bkper CLI on live Books.
 *
 *     npx tsx scripts/verify-balance-line.ts [--root=<id or name>] [--month=YYYY-MM] <bookId> [<bookId> ...]
 *
 * For each position root of each Book (or those given with `--root`, repeatable), it builds, as
 * the Worker does, the reports of its balance now, at the end of last month, and at the end of
 * each `--month` (repeatable), each from its own planned queries only (the balance and the one it
 * compares with), and checks:
 *
 * - that the report shows the 12 month-ends ending at its day, read from no other query;
 * - that each of the 11 earlier points equals the CLI's balance of the root at that month-end
 *   (`before:` the next month), and the last one the CLI's balance of the report's own dates
 *   (`before:$d+1` now), to the cent;
 * - that the last point is the headline, exactly;
 * - that the line is offered with those 12 points whenever any of them has an amount, and only
 *   then.
 *
 * The CLI shows raw balances negated for permanent accounts, so an amount is flipped when the
 * root's `credit` equals its `permanent`. Uses your `bkper auth token`; never writes to a Book.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Amount, Bkper } from 'bkper-js';
import type { PeriodParts } from 'report-shared/report-intent';
import { readQueryBalances } from '../server/src/services/balances.ts';
import { isoMonth } from '../server/src/services/periods.ts';
import { reportIntentOf } from '../server/src/services/report-intent.ts';
import {
    BALANCE_LINE_MONTHS,
    buildReport,
    planQueries,
    planReport,
    type ReportData,
} from '../server/src/services/report.ts';
import { quote, type Snapshot, type SnapshotGroup } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const run = promisify(execFile);

let checks = 0;
let failures = 0;

function check(ok: boolean, message: string): void {
    checks++;
    if (!ok) {
        failures++;
        console.log(`  FAIL ${message}`);
    }
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

/**
 * The CLI's balance of a group's query at its `before:`: its top row in the last column, which
 * the CLI lists as the running total at the query's end.
 */
async function cliBalance(bookId: string, query: string): Promise<Amount> {
    const { stdout } = await run(
        'bkper',
        ['balance', 'list', '-b', bookId, '-q', query, '--expanded', '0'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    const [header = [], top] = JSON.parse(stdout) as (string | number)[][];
    if (!top) {
        return new Amount(0);
    }
    return new Amount(String(top[header.length - 1] ?? 0));
}

/**
 * Whether a report's amount is the CLI's: exactly, or at the precision the CLI prints amounts
 * (JavaScript numbers) when Bkper answers with more digits than a number holds.
 */
function sameAmount(actual: string, expected: Amount): boolean {
    const amount = new Amount(actual);
    return amount.eq(expected) || amount.toNumber() === expected.toNumber();
}

function nextMonth(month: string): string {
    const [year, monthOfYear] = month.split('-').map(Number);
    return monthOfYear === 12 ? isoMonth(year + 1, 1) : isoMonth(year, monthOfYear + 1);
}

async function verifyReport(
    bkper: Bkper,
    bookId: string,
    snapshot: Snapshot,
    root: SnapshotGroup,
    period: PeriodParts,
    label: string
): Promise<void> {
    const intent = reportIntentOf({ root: root.id, period, monthly: false });
    const queries = planQueries(planReport(intent, snapshot));
    const book = await bkper.getBook(bookId);
    const balances = await Promise.all(
        queries.map(async query => {
            const asked = new Date();
            return readQueryBalances(query, await book.getBalancesReport(query), asked);
        })
    );
    const report: ReportData = buildReport(intent, snapshot, balances);
    const where = `${root.name} ${label} (${report.query})`;
    console.log(`${where}: ${report.answer.amount}, ${report.months[0]} – ${report.months.at(-1)}`);

    // The balance and the one it compares with: the line needs no query of its own.
    check(
        queries.length === 2,
        `${where}: read ${queries.length} queries, not the balance's and its comparison's`
    );
    check(
        report.months.length === BALANCE_LINE_MONTHS,
        `${where}: shows ${report.months.length} month-ends, not ${BALANCE_LINE_MONTHS}`
    );

    const flip = root.credit === root.permanent;
    const filter = `group:${quote(root.name)}`;
    const ownDates = report.period.dates.replace(/ by:m$/, '');
    const amounts = await Promise.all(
        report.months.map((month, i) =>
            cliBalance(
                bookId,
                i === report.months.length - 1
                    ? `${filter} ${ownDates}`
                    : `${filter} before:${nextMonth(month)}`
            ).then(amount => (flip ? amount.times(-1) : amount))
        )
    );
    const line = report.charts.views.find(view => view.kind === 'line');
    const points = rootMonths(report);
    report.months.forEach((month, i) =>
        check(
            sameAmount(points[i], amounts[i]),
            `${where}: ${month} is ${points[i]}, the CLI's ${amounts[i].toString()}`
        )
    );
    check(
        points.at(-1) === report.answer.amount,
        `${where}: the last point ${points.at(-1)} is not the headline ${report.answer.amount}`
    );
    const hasAmount = points.some(point => !new Amount(point).eq(0));
    if (hasAmount) {
        check(
            line?.kind === 'line' &&
                line.series.length === 1 &&
                line.series[0].amounts.join() === points.join(),
            `${where}: no line of the ${BALANCE_LINE_MONTHS} month-ends is offered`
        );
    } else {
        check(line === undefined, `${where}: a line of zeros is offered`);
    }
}

/** The root's amounts by month, as the report draws them: zeros when it draws none. */
function rootMonths(report: ReportData): string[] {
    const chart = [report.chart, ...report.charts.views].find(
        view => view.kind === 'line' || view.kind === 'area'
    );
    if (chart && (chart.kind === 'line' || chart.kind === 'area')) {
        return chart.series[0].amounts;
    }
    // No line offered: every month is zero.
    return report.months.map(() => '0');
}

async function verifyBook(
    bkper: Bkper,
    bookId: string,
    only: string[],
    months: string[]
): Promise<void> {
    const timing = new ServerTiming();
    const snapshot = await loadSnapshot(bookId, {
        userId: await currentUserId(bkper, timing),
        bkper,
        kv: new MemoryStore(),
        timing,
    });
    console.log(`\n${snapshot.book.name} (${bookId}), today ${snapshot.today}`);
    const roots = snapshot.roots
        .map(id => snapshot.groups[id])
        .filter(group => group.permanent)
        .filter(group => only.length === 0 || only.includes(group.id) || only.includes(group.name));
    if (roots.length === 0) {
        console.log('  No position root.');
        failures++;
        return;
    }
    for (const root of roots) {
        await verifyReport(bkper, bookId, snapshot, root, { span: 'now' }, 'now');
        await verifyReport(
            bkper,
            bookId,
            snapshot,
            root,
            { span: 'month', month: 'previous' },
            'at the end of last month'
        );
        for (const month of months) {
            const [year, monthOfYear] = month.split('-').map(Number);
            await verifyReport(
                bkper,
                bookId,
                snapshot,
                root,
                { span: 'month', year, month: monthOfYear as PeriodParts['month'] },
                `at the end of ${month}`
            );
        }
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const option = (name: string) =>
        args.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
    const only = option('root');
    const months = option('month');
    const bookIds = args.filter(arg => !arg.startsWith('--'));
    if (bookIds.length === 0 || months.some(month => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
        console.error(
            'Usage: npx tsx scripts/verify-balance-line.ts [--root=<id or name>] [--month=YYYY-MM] <bookId> [<bookId> ...]'
        );
        process.exit(2);
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    for (const bookId of bookIds) {
        await verifyBook(bkper, bookId, only, months);
    }
    console.log(
        failures === 0
            ? `\nAll ${checks} checks passed.`
            : `\n${failures} of ${checks} checks failed.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
