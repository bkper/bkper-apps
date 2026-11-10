/**
 * Runs requests of the period evaluation through the app's report pipeline, end to end, on the
 * real decision model and live Books, read-only.
 *
 *     npx tsx scripts/eval-periods/e2e.ts [--all] [--only=<n>,...]
 *
 * Each request is sent as a prompt to `createReport`, the service the `/report` route runs, with
 * the real Jev and the app's balances loader reading the Book (read-only, with your
 * `bkper auth token`; Jev with `BKPER_AI_TOKEN` or the same token), the report's texts in
 * English. For each it checks:
 *
 * - the query read: the months of the report's query, and of the query it compares with, are
 *   the months of the period the case expects, and of its comparison (a request that names no
 *   period reads the default period, as the intent says; one that has not started answers
 *   `future_period`; a comparison that cannot be made is reported and the previous period read);
 * - the labels: the days Bkper says each query read (`rangeBeginLabel`, `rangeEndLabel`, from a
 *   call of its own) are the expected months', and the Source's dates are those days;
 * - the amounts: every amount of the report (each Answer, every row of the breakdown at any
 *   depth, now, before and in each month) equals, to the cent, the bkper-js balance of the same
 *   group or account in its own call of the same query; a net result Report calculates is the
 *   only amount left out.
 *
 * A case is asked on the Book's today only: cases whose `today` is in the Book's current month
 * are re-anchored to the Book's today (every period is whole months, so they read the same
 * months; only a balance now reads to the Book's today), and the others are skipped. By default
 * it runs the first of those cases of each category and of each language; `--all` runs all of
 * them. Nothing is written to any Book.
 */
import { execFileSync } from 'node:child_process';
import { Amount, Bkper, type BalancesContainer, type BalancesReport, type Book } from 'bkper-js';
import { withoutIsolates } from 'report-shared/bidi';
import { addAllLocales } from 'report-shared/locales';
import type { BreakdownRow, ReportSpec } from 'report-shared/catalog';
import { loadBalances } from '../../server/src/services/balances-loader.ts';
import { readDays } from '../../server/src/services/bkper-dates.ts';
import { createDecisionClient } from '../../server/src/services/decision-client.ts';
import {
    buildPeriodQuery,
    resolveQueryDates,
    type QueryDates,
} from '../../server/src/services/period-query.ts';
import { addDays, type ReportNature } from '../../server/src/services/periods.ts';
import { ReportError } from '../../server/src/services/report.ts';
import { createReport, type ReportResult } from '../../server/src/services/report-service.ts';
import type { Snapshot } from '../../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../../server/src/services/timing.ts';
import { BOOKS, CASES, expectations, type BookKey, type PeriodCase } from './cases.ts';
import { meaningOf, type Meaning } from './score.ts';

addAllLocales();

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

function option(name: string): string | undefined {
    const prefix = `--${name}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

/** The date part of a report's query: its `on:`, `after:`, `before:` and `by:` tokens. */
function datePart(query: string): string {
    return query
        .split(/\s+/)
        .filter(token => /^(?:on|after|before|by):/.test(token))
        .join(' ');
}

/** The first month after a month. */
function nextMonth(month: string): string {
    const [year, monthOfYear] = month.split('-').map(Number);
    return monthOfYear === 12
        ? `${year + 1}-01`
        : `${year}-${String(monthOfYear + 1).padStart(2, '0')}`;
}

/** The days a query of these months reads: from the first day of its first month, up to `before`. */
function daysOf(dates: QueryDates): { after?: string; before?: string } {
    return {
        ...(dates.first === undefined ? {} : { after: `${dates.first}-01` }),
        ...(dates.beforeDay !== undefined
            ? { before: dates.beforeDay }
            : dates.last === undefined
              ? {}
              : { before: `${nextMonth(dates.last)}-01` }),
    };
}

function sameMonths(a: QueryDates | undefined, b: QueryDates | undefined): boolean {
    return a?.first === b?.first && a?.last === b?.last && a?.beforeDay === b?.beforeDay;
}

function describe(dates: QueryDates | undefined): string {
    if (!dates) {
        return 'none';
    }
    const end = dates.beforeDay ? `<${dates.beforeDay}` : (dates.last ?? '');
    return dates.first ? `${dates.first}…${end}` : `…${end}`;
}

interface CaseRun {
    test: PeriodCase;
    number: number;
    today: string;
    problems: string[];
    checks: number;
    summary: string;
}

/** Every container of a Bkper answer, by name; an account in several groups once. */
function containersOf(report: BalancesReport): Map<string, BalancesContainer> {
    const byName = new Map<string, BalancesContainer>();
    const visit = (container: BalancesContainer): void => {
        if (!byName.has(container.getName())) {
            byName.set(container.getName(), container);
        }
        container.getBalancesContainers().forEach(visit);
    };
    report.getBalancesContainers().forEach(visit);
    return byName;
}

/** A group's or account's amount in a Bkper answer, as reports read it; zero when left out. */
function amountOf(container: BalancesContainer | undefined, nature: ReportNature): Amount {
    if (!container) {
        return new Amount(0);
    }
    return nature === 'position' ? container.getCumulativeBalance() : container.getPeriodBalance();
}

/** Its amount in a month: activity within it, a position at its end. */
function monthAmountOf(
    container: BalancesContainer | undefined,
    nature: ReportNature,
    month: string
): Amount {
    const balances = (container?.getBalances() ?? [])
        .map(balance => ({
            month: `${balance.getYear()}-${String(balance.getMonth()).padStart(2, '0')}`,
            balance,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
    if (nature === 'position') {
        return (
            balances
                .filter(entry => entry.month <= month)
                .at(-1)
                ?.balance.getCumulativeBalance() ?? new Amount(0)
        );
    }
    return (
        balances.find(entry => entry.month === month)?.balance.getPeriodBalance() ?? new Amount(0)
    );
}

class Checker {
    readonly problems: string[] = [];
    checks = 0;

    check(ok: boolean, message: string): void {
        this.checks++;
        if (!ok) {
            this.problems.push(message);
        }
    }
}

/** Reads each query once from Bkper, apart from the app. */
class OwnReads {
    private readonly reads = new Map<string, Promise<BalancesReport>>();
    constructor(private readonly book: Book) {}
    read(query: string): Promise<BalancesReport> {
        let read = this.reads.get(query);
        if (!read) {
            read = this.book.getBalancesReport(query);
            this.reads.set(query, read);
        }
        return read;
    }
}

/** What the case expects: the meaning of each reading it accepts, at the Book's today. */
function expectedMeanings(test: PeriodCase, today: string): Meaning[] {
    return expectations(test).map(request => meaningOf({ request }, today, test.nature));
}

/** The comparison a reading falls back to when the one asked for cannot be made. */
function fallbackComparison(test: PeriodCase, today: string): (QueryDates | undefined)[] {
    return expectations(test).map(request => {
        const built = buildPeriodQuery({ period: request.period }, { today, nature: test.nature });
        return built.ok && built.comparison
            ? resolveQueryDates(built.comparison.dates, today)
            : undefined;
    });
}

async function runCase(
    test: PeriodCase,
    number: number,
    snapshot: Snapshot,
    book: Book,
    own: OwnReads,
    options: { userId: string; client: ReturnType<typeof createDecisionClient> }
): Promise<CaseRun> {
    const today = snapshot.today;
    const checker = new Checker();
    const batches: string[][] = [];
    const kv = new MemoryStore();
    const timing = new ServerTiming();
    let result: ReportResult | undefined;
    let error: unknown;
    try {
        result = await createReport(
            snapshot,
            { prompt: test.prompt },
            { requested: 'en' },
            {
                decisions: options.client,
                timing,
                // The app's loader, as the route runs it, with a cache of this request alone.
                loadBalances: queries => {
                    batches.push(queries);
                    return loadBalances(queries, {
                        userId: options.userId,
                        bookId: book.getId(),
                        today,
                        kv,
                        timing,
                        read: query => book.getBalancesReport(query),
                    });
                },
            }
        );
    } catch (caught) {
        error = caught;
    }
    const expected = expectedMeanings(test, today);
    const run = (summary: string): CaseRun => ({
        test,
        number,
        today,
        problems: checker.problems,
        checks: checker.checks,
        summary,
    });

    if (expected.some(meaning => meaning.reason === 'future_period')) {
        checker.check(
            error instanceof ReportError && error.reason === 'future_period',
            `expected future_period, got ${error instanceof Error ? error.message : 'a report'}`
        );
        checker.check(batches.length === 0, 'read balances for a period that has not started');
        return run('future_period');
    }
    if (!result) {
        checker.check(
            false,
            `no report: ${error instanceof Error ? error.message : String(error)}`
        );
        return run('-');
    }

    // The query read, and the query it compares with: the last batch is the report's own.
    const spec = result.spec;
    const periodDates = datePart(result.query);
    const last = batches.at(-1) ?? [];
    const current = last.filter(query => datePart(query) === periodDates);
    const comparisonQueries = last.filter(query => datePart(query) !== periodDates);
    const comparisonDates = [...new Set(comparisonQueries.map(datePart))];
    checker.check(
        comparisonDates.length <= 1,
        `several comparisons: ${comparisonDates.join(' | ')}`
    );
    const readPeriod = resolveQueryDates(periodDates, today);
    const readComparison =
        comparisonDates[0] === undefined ? undefined : resolveQueryDates(comparisonDates[0], today);
    const nature: ReportNature = test.nature;

    if (expected.every(meaning => meaning.reason === 'unspecified_period')) {
        // The default period: the intent's period, as built, is what was read.
        const built = buildPeriodQuery(
            {
                period: result.intent.period,
                ...(result.intent.compared ? { compared: result.intent.compared } : {}),
                ...(result.intent.compareWith ? { compareWith: result.intent.compareWith } : {}),
            },
            { today, nature }
        );
        checker.check(
            built.ok && built.period.dates === periodDates,
            `default period ${JSON.stringify(result.intent.period)} read ${periodDates}`
        );
        checker.check(
            result.trace.judgments !== undefined &&
                ['year', 'month', 'quarter'].every(id => {
                    const part = result?.trace.judgments?.[id as 'year' | 'month' | 'quarter'];
                    return part?.read === undefined;
                }),
            'a request that names no period read a part of one'
        );
    } else {
        const fallbacks = fallbackComparison(test, today);
        const matches = expected.some((meaning, index) => {
            if (!sameMonths(meaning.period, readPeriod)) {
                return false;
            }
            if (meaning.comparisonError) {
                return (
                    result?.trace.comparisonError === meaning.comparisonError &&
                    sameMonths(fallbacks[index], readComparison)
                );
            }
            return (
                result?.trace.comparisonError === undefined &&
                sameMonths(meaning.comparison, readComparison)
            );
        });
        checker.check(
            matches,
            `read ${describe(readPeriod)} vs ${describe(readComparison)}${
                result.trace.comparisonError ? ` (${result.trace.comparisonError})` : ''
            }, expected ${expected
                .map(
                    meaning =>
                        `${describe(meaning.period)} vs ${describe(meaning.comparison)}${
                            meaning.comparisonError ? ` (${meaning.comparisonError})` : ''
                        }`
                )
                .join(' or ')}`
        );
    }

    // The labels: the days Bkper says it read, in its own answer, and the Source's dates.
    const reports = {
        current: await Promise.all(current.map(query => own.read(query))),
        comparison: await Promise.all(comparisonQueries.map(query => own.read(query))),
    };
    const pattern = snapshot.book.datePattern;
    const labelled = (answer: BalancesReport, dates: QueryDates, what: string) => {
        const days = readDays(answer.payload, pattern);
        const want = daysOf(dates);
        checker.check(
            days !== undefined && days.before === want.before,
            `${what} Bkper read to ${days?.before ?? '?'}, expected ${want.before}`
        );
        if (want.after !== undefined && nature === 'activity') {
            checker.check(
                days?.after === want.after,
                `${what} Bkper read from ${days?.after ?? 'the start'}, expected ${want.after}`
            );
        }
    };
    reports.current.forEach(answer => labelled(answer, readPeriod, 'period'));
    if (readComparison) {
        reports.comparison.forEach(answer => labelled(answer, readComparison, 'comparison'));
    }
    const source = Object.values(spec.elements).find(element => element.type === 'Source');
    const sourceText = source?.type === 'Source' ? withoutIsolates(source.props.period) : '';
    const read = daysOf(readPeriod);
    if (read.before !== undefined) {
        const day = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
        const utc = (date: string) => new Date(`${date}T00:00:00Z`);
        const lastDay = addDays(read.before, -1);
        const wanted =
            nature === 'activity' && read.after !== undefined
                ? day.formatRange(utc(read.after), utc(lastDay))
                : day.format(utc(lastDay));
        checker.check(
            nature === 'activity' && read.after !== undefined
                ? sourceText === wanted
                : sourceText.includes(wanted),
            `Source dates "${sourceText}", expected "${wanted}"`
        );
    }

    // The amounts: each one the bkper-js balance of its group or account in the same query.
    const now = mergedContainers(reports.current);
    const before = mergedContainers(reports.comparison);
    const months = tableMonths(spec);
    const calculated = source?.type === 'Source' && source.props.calculated !== undefined;
    let amounts = 0;
    const same = (actual: string | undefined, wanted: Amount, what: string) => {
        amounts++;
        checker.check(
            actual !== undefined && new Amount(actual).eq(wanted),
            `${what}: ${actual ?? 'none'}, Bkper ${wanted.toFixed()}`
        );
    };
    for (const element of Object.values(spec.elements)) {
        if (element.type !== 'Answer' || calculated) {
            continue;
        }
        const name = withoutIsolates(element.props.label);
        const node = now.get(name);
        checker.check(node !== undefined, `Answer ${name} is not in Bkper's answer`);
        same(element.props.amount, amountOf(node, nature), `Answer ${name}`);
        if (readComparison) {
            same(
                element.props.previous,
                amountOf(before.get(name), nature),
                `Answer ${name} before`
            );
        }
    }
    const visit = (row: BreakdownRow) => {
        const name = withoutIsolates(row.label);
        const node = now.get(name);
        same(row.amount, amountOf(node, nature), `row ${name}`);
        if (readComparison && row.previous !== undefined) {
            same(row.previous, amountOf(before.get(name), nature), `row ${name} before`);
        }
        row.months.forEach((amount, index) =>
            same(amount, monthAmountOf(node, nature, months[index]), `row ${name} ${months[index]}`)
        );
        row.children.forEach(visit);
    };
    for (const element of Object.values(spec.elements)) {
        if (element.type === 'BreakdownTable') {
            element.props.rows.forEach(visit);
        }
    }
    return run(
        `${periodDates}${comparisonDates[0] ? ` vs ${comparisonDates[0]}` : ''}; "${withoutIsolates(
            reportSubtitle(spec)
        )}"; ${amounts} amounts${calculated ? ' (net result calculated: answer left out)' : ''}`
    );
}

function mergedContainers(reports: BalancesReport[]): Map<string, BalancesContainer> {
    const merged = new Map<string, BalancesContainer>();
    for (const report of reports) {
        for (const [name, container] of containersOf(report)) {
            if (!merged.has(name)) {
                merged.set(name, container);
            }
        }
    }
    return merged;
}

function tableMonths(spec: ReportSpec): string[] {
    const table = Object.values(spec.elements).find(element => element.type === 'BreakdownTable');
    return table?.type === 'BreakdownTable' ? table.props.months : [];
}

function reportSubtitle(spec: ReportSpec): string {
    const root = spec.elements[spec.root];
    return root?.type === 'Report' ? root.props.subtitle : '';
}

/** The cases asked: those in the Book's current month, re-anchored to its today. */
function selectCases(
    snapshots: Record<BookKey, Snapshot>,
    all: boolean,
    only: number[]
): { test: PeriodCase; number: number }[] {
    const applicable = CASES.map((test, index) => ({ test, number: index + 1 })).filter(
        ({ test, number }) =>
            (only.length === 0 || only.includes(number)) &&
            test.today.slice(0, 7) === snapshots[test.book].today.slice(0, 7)
    );
    if (all || only.length > 0) {
        return applicable;
    }
    const categories = new Set<string>();
    const languages = new Set<string>();
    return applicable.filter(({ test }) => {
        const fresh = !categories.has(test.category) || !languages.has(test.language);
        categories.add(test.category);
        languages.add(test.language);
        return fresh;
    });
}

async function main(): Promise<void> {
    const only = (option('only') ?? '').split(',').filter(Boolean).map(Number);
    const all = process.argv.includes('--all');
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const userId = await currentUserId(bkper, new ServerTiming());
    const snapshots = {} as Record<BookKey, Snapshot>;
    const books = {} as Record<BookKey, Book>;
    const reads = {} as Record<BookKey, OwnReads>;
    for (const key of Object.keys(BOOKS) as BookKey[]) {
        snapshots[key] = await loadSnapshot(BOOKS[key], {
            userId,
            bkper,
            kv: new MemoryStore(),
            timing: new ServerTiming(),
        });
        books[key] = await bkper.getBook(BOOKS[key]);
        reads[key] = new OwnReads(books[key]);
    }
    const client = createDecisionClient({
        apiKey: process.env.BKPER_AI_TOKEN || token,
        headers: { 'bkper-ai-source': 'report-eval-periods' },
    });
    const selected = selectCases(snapshots, all, only);
    const skipped = CASES.filter(
        test => test.today.slice(0, 7) !== snapshots[test.book].today.slice(0, 7)
    ).length;
    console.log(
        `Books' today: ${Object.entries(snapshots)
            .map(([key, snapshot]) => `${key} ${snapshot.today}`)
            .join(
                ', '
            )}; ${selected.length} cases, ${skipped} of ${CASES.length} skipped (asked on another month)`
    );
    const runs: CaseRun[] = [];
    for (const { test, number } of selected) {
        const snapshot = snapshots[test.book];
        const run = await runCase(test, number, snapshot, books[test.book], reads[test.book], {
            userId,
            client,
        });
        runs.push(run);
        const anchored = test.today === run.today ? '' : `, re-anchored from ${test.today}`;
        console.log(
            `${run.problems.length === 0 ? 'ok  ' : 'FAIL'} #${number} [${test.category}, ${test.language}, ${test.book}, ${run.today}${anchored}] "${test.prompt}"\n       ${run.summary}` +
                run.problems.map(problem => `\n       ✗ ${problem}`).join('')
        );
    }
    const failed = runs.filter(run => run.problems.length > 0);
    const checks = runs.reduce((sum, run) => sum + run.checks, 0);
    const covered = (key: 'category' | 'language') =>
        [...new Set(runs.map(run => run.test[key]))].join(', ');
    console.log(
        `\n${runs.length - failed.length}/${runs.length} cases passed, ${checks} checks` +
            `\ncategories: ${covered('category')}\nlanguages: ${covered('language')}`
    );
    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

await main();
