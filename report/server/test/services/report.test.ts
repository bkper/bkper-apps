import { Amount } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import type { QueryBalances } from '../../src/services/balances';
import {
    MissingBalancesError,
    ReportError,
    buildReport,
    historyQuery,
    planQueries,
    planReport,
    viewKindOf,
    type ReportChart,
    type ReportData,
    type ReportRow,
    type ViewKind,
} from '../../src/services/report';
import type { PeriodParts } from 'report-shared/report-intent';
import { reportIntentOf, type ReportIntent } from '../../src/services/report-intent';
import type { Snapshot } from '../../src/services/snapshot';
import type { FakeLedger } from '../fixtures/ledger';
import {
    DATA_AT,
    fixtureLedger,
    fixtureSnapshot,
    ledgerBalances,
    ledgerSnapshot,
    simpleRootsLedger,
} from '../fixtures/snapshot-book';

/** An intent of a period id, as older intents wrote it, or of parts. */
function intent(
    root: string,
    period: string | PeriodParts,
    extra: Partial<ReportIntent> = {}
): ReportIntent {
    return reportIntentOf({ root, period, monthly: false, ...extra });
}

/** The balances of every query a report plans, read from the ledger as Bkper answers them. */
function balancesOf(
    request: ReportIntent,
    snapshot: Snapshot,
    ledger: FakeLedger
): QueryBalances[] {
    return planQueries(planReport(request, snapshot)).map(query => ledgerBalances(ledger, query));
}

/** The report of an intent on a ledger (the fixture's by default), and its map unless given. */
async function report(
    request: ReportIntent,
    ledger: FakeLedger = fixtureLedger(),
    snapshot?: Snapshot
): Promise<ReportData> {
    const map = snapshot ?? (await ledgerSnapshot(ledger));
    return buildReport(request, map, balancesOf(request, map, ledger));
}

/** Name, amount, previous and change of each row, children indented. */
function rows(breakdown: ReportRow[], depth = 0): string[] {
    return breakdown.flatMap(row => [
        `${'  '.repeat(depth)}${row.name} ${row.amount} (prev ${row.previous ?? '-'}` +
            `, change ${row.change ?? '-'}, share ${row.share ?? '-'})`,
        ...rows(row.children, depth + 1),
    ]);
}

describe('planReport', () => {
    const queries = async (request: ReportIntent, ledger: FakeLedger = fixtureLedger()) =>
        planQueries(planReport(request, await ledgerSnapshot(ledger)));

    it('reads a root for the period and for the previous one, in whole months', async () => {
        expect(await queries(intent('g-expenses', 'last_month'))).toEqual([
            "group:'Expenses' on:$m-1 by:m",
            "group:'Expenses' on:$m-2 by:m",
        ]);
        // A running period reads through the end of the current month, its comparison the
        // whole month before.
        expect(await queries(intent('g-expenses', 'this_month'))).toEqual([
            "group:'Expenses' on:$m by:m",
            "group:'Expenses' on:$m-1 by:m",
        ]);
        // Activity today reads the month: there is no period of a day.
        expect(await queries(intent('g-expenses', 'today'))).toEqual([
            "group:'Expenses' on:$m by:m",
            "group:'Expenses' on:$m-1 by:m",
        ]);
        expect(await queries(intent('g-expenses', 'all'))).toEqual([
            "group:'Expenses' before:$m+1 by:m",
        ]);
    });

    it('compares a running period with the same months of the previous one', async () => {
        expect(await queries(intent('g-expenses', 'this_year'))).toEqual([
            "group:'Expenses' after:$y before:$m+1 by:m",
            "group:'Expenses' after:$y-1 before:$m-11 by:m",
        ]);
        expect(await queries(intent('g-expenses', '2026-Q4'))).toEqual([
            "group:'Expenses' after:2026-10 before:2026-12 by:m",
            "group:'Expenses' after:2026-07 before:2026-09 by:m",
        ]);
        expect(await queries(intent('g-expenses', 'last_12_months'))).toEqual([
            "group:'Expenses' after:$m-11 before:$m+1 by:m",
            "group:'Expenses' after:$m-23 before:$m-11 by:m",
        ]);
    });

    it('writes relative periods with variables and written ones in ISO, all by month', async () => {
        const all = await Promise.all(
            [
                'today',
                'this_quarter',
                'last_quarter',
                'last_year',
                'ytd',
                '2025',
                '2025-Q2',
                '2025-03',
            ].map(period => queries(intent('g-expenses', period)))
        );
        for (const query of all.flat()) {
            expect(query).toMatch(/ by:m$/);
            // Never a full date, which Bkper reads by day.
            expect(query).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        }
        expect(all[3]).toEqual(["group:'Expenses' on:$y-1 by:m", "group:'Expenses' on:$y-2 by:m"]);
        expect(all[5]).toEqual(["group:'Expenses' on:2025 by:m", "group:'Expenses' on:2024 by:m"]);
        expect(all[7]).toEqual([
            "group:'Expenses' on:2025-03 by:m",
            "group:'Expenses' on:2025-02 by:m",
        ]);
    });

    it('reads a position at the end of the period and of the previous one', async () => {
        // A balance now is the only day a report reads.
        expect(await queries(intent('g-assets', 'today'))).toEqual([
            "group:'Assets' before:$d+1 by:m",
            "group:'Assets' before:$m by:m",
        ]);
        expect(await queries(intent('g-assets', '2025'))).toEqual([
            "group:'Assets' before:2026-01 by:m",
            "group:'Assets' before:2025-01 by:m",
        ]);
    });

    it('reads the same period a year earlier when the intent compares with it', async () => {
        const yearEarlier = { compareWith: 'year_earlier' } as const;
        expect(await queries(intent('g-expenses', '2026-01', yearEarlier))).toEqual([
            "group:'Expenses' on:2026-01 by:m",
            "group:'Expenses' on:2025-01 by:m",
        ]);
        // A running month is read whole, against the whole month a year earlier.
        expect(await queries(intent('g-expenses', '2026-11', yearEarlier))).toEqual([
            "group:'Expenses' on:2026-11 by:m",
            "group:'Expenses' on:2025-11 by:m",
        ]);
        expect(await queries(intent('g-assets', 'today', yearEarlier))).toEqual([
            "group:'Assets' before:$d+1 by:m",
            "group:'Assets' before:$m-11 by:m",
        ]);
        expect(await queries(intent('g-expenses', 'all', yearEarlier))).toEqual([
            "group:'Expenses' before:$m+1 by:m",
        ]);
    });

    it('reads the period compared with as the intent names it', async () => {
        // Revenue last year vs 2023: both whole years, each as written.
        expect(
            await queries(
                intent(
                    'g-expenses',
                    { span: 'year', year: 'previous' },
                    { compared: { year: 2023 } }
                )
            )
        ).toEqual(["group:'Expenses' on:$y-1 by:m", "group:'Expenses' on:2023 by:m"]);
        // Q3 vs Q1, in no year: the latest of each before.
        expect(
            await queries(intent('g-expenses', { quarter: 3 }, { compared: { quarter: 1 } }))
        ).toEqual([
            "group:'Expenses' after:2026-07 before:2026-10 by:m",
            "group:'Expenses' after:2026-01 before:2026-04 by:m",
        ]);
    });

    it('compares with the previous period when the comparison asked for cannot be made', async () => {
        const snapshot = await fixtureSnapshot();
        // A month is another kind of period than a year.
        const mismatch = planReport(
            intent('g-expenses', { span: 'year', year: 2025 }, { compared: { month: 3 } }),
            snapshot
        );
        expect(planQueries(mismatch)).toEqual([
            "group:'Expenses' on:2025 by:m",
            "group:'Expenses' on:2024 by:m",
        ]);
        expect(mismatch.period.comparisonError).toBe('comparison_kind_mismatch');
        // A comparison that overlaps the period is no earlier period.
        const overlap = planReport(
            intent('g-expenses', { span: 'year', year: 2025 }, { compared: { year: 2025 } }),
            snapshot
        );
        expect(planQueries(overlap)).toEqual([
            "group:'Expenses' on:2025 by:m",
            "group:'Expenses' on:2024 by:m",
        ]);
        expect(overlap.period.comparisonError).toBe('comparison_not_earlier');
        // All time has nothing before it.
        const all = planReport(
            intent('g-expenses', { span: 'all_time' }, { compareWith: 'year_earlier' }),
            snapshot
        );
        expect(planQueries(all)).toEqual(["group:'Expenses' before:$m+1 by:m"]);
        expect(all.period.comparisonError).toBe('comparison_unavailable');
        // A comparison that can be made says nothing.
        expect(
            planReport(intent('g-expenses', '2025', { compareWith: 'year_earlier' }), snapshot)
                .period.comparisonError
        ).toBeUndefined();
        const data = await report(
            intent('g-expenses', { span: 'year', year: 2025 }, { compared: { month: 3 } })
        );
        expect(data.comparisonError).toBe('comparison_kind_mismatch');
        expect(data.previous).toMatchObject({ dates: 'on:2024 by:m' });
        // What was asked for stays the intent's.
        expect(data.intent.compared).toEqual({ month: 3 });
    });

    it('reads the group that combines Incoming and Outgoing for a net result', async () => {
        expect(await queries(intent('net-result', 'last_month'))).toEqual([
            "group:'Net income' on:$m-1 by:m",
            "group:'Net income' on:$m-2 by:m",
        ]);
    });

    it('reads each simple activity root of a net result with a query of its own', async () => {
        expect(await queries(intent('net-result', 'last_month'), simpleRootsLedger())).toEqual([
            "group:'Expenses' on:$m-1 by:m",
            "group:'Expenses' on:$m-2 by:m",
            "group:'Revenue' on:$m-1 by:m",
            "group:'Revenue' on:$m-2 by:m",
        ]);
    });

    it('filters the queries by the hashtag', async () => {
        expect(await queries(intent('g-expenses', 'last_month', { hashtags: ['trip'] }))).toEqual([
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
        ]);
    });

    it('reads a position with hashtags from the start, as Bkper starts it at after: unfiltered', async () => {
        expect(await queries(intent('g-assets', '2026-Q4', { hashtags: ['trip'] }))).toEqual([
            "group:'Assets' #trip before:$d+1 by:m",
            "group:'Assets' #trip before:2026-09 by:m",
        ]);
    });

    it('reads the history of a report through the current month', async () => {
        const snapshot = await fixtureSnapshot();
        expect(
            historyQuery(planReport(intent('g-expenses', 'this_year'), snapshot), snapshot)
        ).toBe("group:'Expenses' before:$m+1 by:m");
    });
});

describe('buildReport: amounts as Bkper returns them', () => {
    /** The balances of a report's queries, with one group's changed as a test wants. */
    async function changed(
        request: ReportIntent,
        change: (balances: QueryBalances) => void
    ): Promise<ReportData> {
        const ledger = fixtureLedger();
        const snapshot = await ledgerSnapshot(ledger);
        const balances = balancesOf(request, snapshot, ledger);
        balances.forEach(change);
        return buildReport(request, snapshot, balances);
    }

    it('takes the total of a period from its period balance, never from its months', async () => {
        const request = intent('g-expenses', '2026', { monthly: true });
        const data = await changed(request, balances => {
            if (balances.query.includes('after:2026-01 ')) {
                balances.groups.Expenses.period = '9999.99';
            }
        });
        expect(data.answer.amount).toBe('9999.99');
        // The months still show their own balances.
        expect(data.chart.kind === 'bar' && data.chart.series[0].amounts.slice(-2)).toEqual([
            '1200.5',
            '1050.25',
        ]);
    });

    it('takes a position from the cumulative balance at the end of each period', async () => {
        const data = await changed(intent('g-assets', 'today'), balances => {
            balances.groups.Assets.cumulative = balances.query.includes('$d+1')
                ? '123.45'
                : '67.89';
        });
        expect(data.answer).toMatchObject({ amount: '123.45', previous: '67.89' });
    });

    it('takes a position from the cumulative balance, not from its last month', async () => {
        const trailing: string[] = [];
        const data = await changed(intent('g-assets', '2025'), balances => {
            // Bkper also lists the month of `before:`, after the period.
            const last = balances.groups.Assets.months.at(-1);
            if (last) {
                trailing.push(last.month);
                last.cumulative = '55.55';
            }
        });
        expect(trailing).toEqual(['2026-01', '2025-01']);
        expect(data.answer).toMatchObject({ amount: '100', previous: '100' });
        expect(data.months).toEqual([
            '2025-01',
            '2025-02',
            '2025-03',
            '2025-04',
            '2025-05',
            '2025-06',
            '2025-07',
            '2025-08',
            '2025-09',
            '2025-10',
            '2025-11',
            '2025-12',
        ]);
    });

    it('fails when a planned query was not read', async () => {
        const snapshot = await fixtureSnapshot();
        expect(() => buildReport(intent('g-expenses', 'last_month'), snapshot, [])).toThrow(
            'The balances of a report query were not read'
        );
    });

    it('dates the report with its oldest balances', async () => {
        const ledger = fixtureLedger();
        const snapshot = await ledgerSnapshot(ledger);
        const request = intent('g-expenses', 'last_month');
        const [current, previous] = planQueries(planReport(request, snapshot));
        const data = buildReport(request, snapshot, [
            ledgerBalances(ledger, current, new Date('2026-11-05T15:00:40Z')),
            ledgerBalances(ledger, previous, new Date('2026-11-05T15:00:10Z')),
        ]);
        expect(data.dataAt).toBe('2026-11-05T15:00:10.000Z');
    });
});

describe('buildReport: activity', () => {
    it('reports a whole month with its breakdown, previous month and exact query', async () => {
        const data = await report(intent('g-expenses', 'last_month'));
        expect(data.nature).toBe('activity');
        expect(data.root).toEqual({
            id: 'g-expenses',
            name: 'Expenses',
            type: 'OUTGOING',
            color: 'red',
        });
        expect(data.period).toEqual({
            after: '2026-10-01',
            before: '2026-11-01',
            dates: 'on:$m-1 by:m',
            kind: 'month',
        });
        expect(data.previous).toEqual({
            after: '2026-09-01',
            before: '2026-10-01',
            dates: 'on:$m-2 by:m',
            kind: 'month',
        });
        expect(data.comparisonError).toBeUndefined();
        expect(data.answer).toEqual({ amount: '1200.5', previous: '0' });
        // The archived account without movements in either period is left out.
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 0, change -, share 0.833)',
            'Food 200.5 (prev 0, change -, share 0.167)',
        ]);
        expect(data.breakdown[0]).toMatchObject({
            id: 'a-rent',
            kind: 'account',
            type: 'OUTGOING',
            color: 'red',
        });
        // The query shown and opened in Bkper is the query read.
        expect(data.query).toBe("group:'Expenses' on:$m-1 by:m");
        expect(planQueries(planReport(data.intent, await fixtureSnapshot()))[0]).toBe(data.query);
        expect(data.url).toBe(
            `https://bkper.app/books/book-1/transactions?query=${encodeURIComponent(data.query)}`
        );
        expect(data.dataAt).toBe(DATA_AT.toISOString());
        expect(data.months).toEqual(['2026-10']);
        expect(data.breakdown.map(row => row.months)).toEqual([['1000'], ['200.5']]);
    });

    it('reads a running month whole, against the whole month before', async () => {
        const ledger = fixtureLedger();
        // Dated later this month: a running month reads it.
        ledger.transactions.push({ date: '2026-11-20', from: 'Bank A', to: 'Food', amount: '9' });
        const data = await report(intent('g-expenses', 'this_month'), ledger);
        expect(data.period).toEqual({
            after: '2026-11-01',
            before: '2026-12-01',
            dates: 'on:$m by:m',
            kind: 'month',
        });
        expect(data.previous).toEqual({
            after: '2026-10-01',
            before: '2026-11-01',
            dates: 'on:$m-1 by:m',
            kind: 'month',
        });
        expect(data.answer).toEqual({
            amount: '1059.25',
            previous: '1200.5',
            change: '-0.1177',
        });
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 1000, change 0, share 0.9441)',
            'Food 59.25 (prev 200.5, change -0.7045, share 0.0559)',
        ]);
    });

    it('reads a calendar period that has not ended through this month, like its current period', async () => {
        const data = await report(intent('g-expenses', '2026', { monthly: true }));
        expect(data.intent.period).toEqual({ span: 'year', year: 2026 });
        expect(data.period).toEqual({
            after: '2026-01-01',
            before: '2026-12-01',
            dates: 'after:2026-01 before:2026-12 by:m',
            kind: 'year',
        });
        // The same months of the year before.
        expect(data.previous).toEqual({
            after: '2025-01-01',
            before: '2025-12-01',
            dates: 'after:2025-01 before:2025-12 by:m',
            kind: 'year',
        });
        expect(data.answer).toEqual({ amount: '3250.75', previous: '1000', change: '2.2508' });
        expect(data.query).toBe("group:'Expenses' after:2026-01 before:2026-12 by:m");
        expect(data.months).toHaveLength(11);
        expect(data.chart).toEqual({
            kind: 'bar',
            series: [
                {
                    id: 'g-expenses',
                    name: 'Expenses',
                    type: 'OUTGOING',
                    color: 'red',
                    amounts: ['0', '0', '0', '0', '0', '0', '0', '1000', '0', '1200.5', '1050.25'],
                },
            ],
        });
    });

    it('has nothing to compare all time with', async () => {
        const data = await report(intent('g-expenses', 'all'));
        expect(data.period).toEqual({
            before: '2026-12-01',
            dates: 'before:$m+1 by:m',
            kind: 'all_time',
        });
        expect(data.previous).toBeUndefined();
        expect(data.answer).toEqual({ amount: '4260.75' });
        expect(data.query).toBe("group:'Expenses' before:$m+1 by:m");
        expect(data.months[0]).toBe('2024-03');
        // Bkper also lists the month of `before:`, which is no month of the period.
        expect(data.months.at(-1)).toBe('2026-11');
        expect(rows(data.breakdown)).toEqual([
            'Rent 4000 (prev -, change -, share 0.9388)',
            'Food 250.75 (prev -, change -, share 0.0589)',
            'Old Supplier 10 (prev -, change -, share 0.0023)',
        ]);
    });

    it('rejects a period that has not started', async () => {
        const snapshot = await fixtureSnapshot();
        expect(() => planReport(intent('g-expenses', '2027'), snapshot)).toThrow(ReportError);
        expect(() => planReport(intent('g-expenses', '2026-12'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'future_period' })
        );
    });

    it('rejects a root that is not a root group of the Book', async () => {
        const snapshot = await fixtureSnapshot();
        for (const root of ['g-banks', 'missing']) {
            expect(() => planReport(intent(root, 'last_month'), snapshot)).toThrow(
                expect.objectContaining({ reason: 'unknown_root' })
            );
        }
    });
});

describe('buildReport: position', () => {
    it('reports the position today against the end of last month', async () => {
        const data = await report(intent('g-assets', 'today'));
        expect(data.nature).toBe('position');
        expect(data.root.color).toBe('blue');
        // A position reads every movement before its day: from the start of the Book.
        expect(data.period).toEqual({
            before: '2026-11-06',
            dates: 'before:$d+1 by:m',
            kind: 'now',
        });
        expect(data.previous).toEqual({
            before: '2026-11-01',
            dates: 'before:$m by:m',
            kind: 'now',
        });
        expect(data.answer).toEqual({ amount: '7849.25', previous: '3899.5', change: '1.0129' });
        expect(rows(data.breakdown)).toEqual([
            'Banks 7749.25 (prev 3799.5, change 1.0395, share 0.9873)',
            '  Bank A 7749.25 (prev 3799.5, change 1.0395, share 1)',
            'Cash 100 (prev 100, change 0, share 0.0127)',
        ]);
        expect(data.breakdown[0]).toMatchObject({ id: 'g-banks', kind: 'group', type: 'ASSET' });
        expect(data.query).toBe("group:'Assets' before:$d+1 by:m");
        expect(data.chart).toEqual({ kind: 'donut', rows: ['g-banks', 'a-cash'] });
    });

    it('shows positions at the end of each month on a line', async () => {
        const data = await report(intent('g-assets', '2026-Q4', { monthly: true }));
        expect(data.period).toEqual({
            before: '2026-11-06',
            dates: 'before:$d+1 by:m',
            kind: 'quarter',
        });
        // The end of the same months of the quarter before: July and August.
        expect(data.previous).toEqual({
            before: '2026-09-01',
            dates: 'before:2026-09 by:m',
            kind: 'quarter',
        });
        expect(data.answer).toEqual({ amount: '7849.25', previous: '100', change: '77.4925' });
        expect(data.months).toEqual(['2026-10', '2026-11']);
        expect(data.chart).toMatchObject({
            kind: 'line',
            series: [{ id: 'g-assets', amounts: ['3899.5', '7849.25'] }],
        });
    });
});

describe('buildReport: a target under its root', () => {
    const plan = async (request: ReportIntent, ledger: FakeLedger = fixtureLedger()) =>
        planQueries(planReport(request, await ledgerSnapshot(ledger)));

    it('reads a nested group from its own queries, not its root’s', async () => {
        const request = intent('g-assets', 'today', { target: 'g-banks' });
        expect(await plan(request)).toEqual([
            "group:'Banks' before:$d+1 by:m",
            "group:'Banks' before:$m by:m",
        ]);

        const data = await report(request);
        expect(data.nature).toBe('position');
        expect(data.root).toEqual({ id: 'g-banks', name: 'Banks', type: 'ASSET', color: 'blue' });
        expect(data.account).toBeUndefined();
        expect(data.answer).toEqual({ amount: '7749.25', previous: '3799.5', change: '1.0395' });
        // Bank B has no amount in either period.
        expect(rows(data.breakdown)).toEqual([
            'Bank A 7749.25 (prev 3799.5, change 1.0395, share 1)',
        ]);
        // The link to Bkper shows the target's own transactions.
        expect(data.query).toBe("group:'Banks' before:$d+1 by:m");
        expect(data.url).toContain(encodeURIComponent("group:'Banks' before:$d+1 by:m"));
    });

    it('reads an account by month from the smallest group holding it', async () => {
        const request = intent('g-expenses', '2026', { monthly: true, target: 'a-rent' });
        expect(await plan(request)).toEqual([
            "group:'Expenses' after:2026-01 before:2026-12 by:m",
            "group:'Expenses' after:2025-01 before:2025-12 by:m",
        ]);

        const data = await report(request);
        expect(data.nature).toBe('activity');
        expect(data.root).toEqual({ id: 'a-rent', name: 'Rent', type: 'OUTGOING', color: 'red' });
        expect(data.account).toBe(true);
        expect(data.answer).toEqual({ amount: '3000', previous: '1000', change: '2' });
        expect(data.breakdown).toEqual([]);
        expect(data.query).toBe("account:'Rent' after:2026-01 before:2026-12 by:m");
        expect(data.chart).toEqual({
            kind: 'bar',
            series: [
                {
                    id: 'a-rent',
                    name: 'Rent',
                    type: 'OUTGOING',
                    color: 'red',
                    amounts: ['0', '0', '0', '0', '0', '0', '0', '1000', '0', '1000', '1000'],
                },
            ],
        });
        // An account has no parts to slice, rank or compare.
        expect(kinds(data)).toEqual(['bar', 'area', 'table']);
    });

    it('reads an account the same from any root that holds it, from the same group', async () => {
        const expenses = await report(intent('g-expenses', 'last_month', { target: 'a-rent' }));
        const net = await report(intent('g-net', 'last_month', { target: 'a-rent' }));
        // Rent is in Expenses and Net income, three accounts each: the first in Book order.
        expect(await plan(intent('g-net', 'last_month', { target: 'a-rent' }))).toEqual([
            "group:'Expenses' on:$m-1 by:m",
            "group:'Expenses' on:$m-2 by:m",
        ]);
        expect(net.answer).toEqual(expenses.answer);
        expect(net.answer).toEqual({ amount: '1000', previous: '0' });
        expect(net.query).toBe(expenses.query);
    });

    it('reads an account from the smallest group holding it, not from its root', async () => {
        const ledger = fixtureLedger();
        ledger.addGroup(
            groupPayload('g-fixed', 'Fixed costs', {
                type: 'OUTGOING',
                credit: false,
                permanent: false,
            }),
            ['a-rent']
        );
        const request = intent('g-expenses', 'last_month', { target: 'a-rent' });
        expect(await plan(request, ledger)).toEqual([
            "group:'Fixed costs' on:$m-1 by:m",
            "group:'Fixed costs' on:$m-2 by:m",
        ]);
        const data = await report(request, ledger);
        // Its own Bkper balance, as its row in its root's query and in its own query.
        const root = ledgerBalances(ledger, "group:'Expenses' on:$m-1 by:m");
        const own = ledgerBalances(ledger, "account:'Rent' on:$m-1 by:m");
        expect(data.answer.amount).toBe(root.accounts.Rent.period);
        expect(data.answer.amount).toBe(own.accounts.Rent.period);
        expect(data.answer).toEqual({ amount: '1000', previous: '0' });
        // The Source and the link name the account, as before.
        expect(data.query).toBe("account:'Rent' on:$m-1 by:m");
    });

    it('counts the groups and the accounts of a group, then takes the first in Book order', async () => {
        // Assets holds Banks, Cash, Bank A and Bank B; Liquid holds three accounts, so Cash
        // reads Liquid, which a count of accounts alone would tie with Assets.
        const ledger = fixtureLedger();
        ledger.addGroup(
            groupPayload('g-liquid', 'Liquid', { type: 'ASSET', credit: false, permanent: true }),
            ['a-cash', 'a-bank-a', 'a-bank-b']
        );
        expect(await plan(intent('g-assets', 'today', { target: 'a-cash' }), ledger)).toEqual([
            "group:'Liquid' before:$d+1 by:m",
            "group:'Liquid' before:$m by:m",
        ]);
        // Bank A: Banks and Liquid hold it, Banks the smaller.
        expect(await plan(intent('g-assets', 'today', { target: 'a-bank-a' }), ledger)).toEqual([
            "group:'Banks' before:$d+1 by:m",
            "group:'Banks' before:$m by:m",
        ]);
        // On a tie, Book order, not the name: Aaa comes after Expenses in the Book.
        ledger.addGroup(
            groupPayload('g-aaa', 'Aaa', { type: 'OUTGOING', credit: false, permanent: false }),
            ['a-rent', 'a-food', 'a-old']
        );
        expect(await plan(intent('g-aaa', 'last_month', { target: 'a-rent' }), ledger)).toEqual([
            "group:'Expenses' on:$m-1 by:m",
            "group:'Expenses' on:$m-2 by:m",
        ]);
        const data = await report(intent('g-assets', 'today', { target: 'a-cash' }), ledger);
        expect(data.answer).toEqual({ amount: '100', previous: '100', change: '0' });
    });

    it('shows each amount as a query of the target alone returns it', async () => {
        const ledger = fixtureLedger();
        const cases = [
            { request: intent('g-assets', '2026-Q4', { target: 'g-banks' }), name: 'Banks' },
            { request: intent('g-expenses', 'this_month', { target: 'a-food' }), name: 'Food' },
        ];
        for (const { request, name } of cases) {
            const data = await report(request, ledger);
            const own = ledgerBalances(ledger, data.query);
            const node = own.groups[name] ?? own.accounts[name];
            expect(data.answer.amount).toBe(
                data.nature === 'position' ? node.cumulative : node.period
            );
        }
    });

    it('reads the history of a target from the group it is read from', async () => {
        const snapshot = await fixtureSnapshot();
        const history = (request: ReportIntent) =>
            historyQuery(planReport(request, snapshot), snapshot);
        expect(history(intent('g-assets', 'this_year', { target: 'a-bank-a' }))).toBe(
            "group:'Banks' before:$m+1 by:m"
        );
        expect(history(intent('g-assets', 'this_year', { target: 'g-banks' }))).toBe(
            "group:'Banks' before:$m+1 by:m"
        );
        // A root's own history, as before.
        expect(history(intent('g-assets', 'this_year'))).toBe("group:'Assets' before:$m+1 by:m");
    });

    it('filters the queries of its group by the hashtags', async () => {
        const request = intent('g-expenses', 'last_month', {
            target: 'a-food',
            hashtags: ['trip'],
        });
        expect(await plan(request)).toEqual([
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
        ]);
        const data = await report(request);
        expect(data.answer).toEqual({ amount: '200.5', previous: '0' });
        expect(data.query).toBe("account:'Food' #trip on:$m-1 by:m");
        const rent = await report({ ...request, target: 'a-rent' });
        expect(rent.answer).toEqual({ amount: '0', previous: '0' });
    });

    it('reads a position with hashtags from the start, as for its root', async () => {
        const request = intent('g-assets', '2026-Q4', {
            monthly: true,
            target: 'a-bank-a',
            hashtags: ['trip'],
        });
        expect(await plan(request)).toEqual([
            "group:'Banks' #trip before:$d+1 by:m",
            "group:'Banks' #trip before:2026-09 by:m",
        ]);
        const data = await report(request);
        expect(data.answer).toMatchObject({ amount: '-1200.5', previous: '0' });
        expect(data.chart).toMatchObject({
            kind: 'line',
            series: [{ id: 'a-bank-a', amounts: ['-200.5', '-1200.5'] }],
        });
    });

    it('reads an account in no group with a query of its own', async () => {
        const request = intent('a-owner', '2026', { monthly: true });
        expect(await plan(request)).toEqual([
            "account:'Owner' before:$d+1 by:m",
            "account:'Owner' before:2025-12 by:m",
        ]);
        const data = await report(request);
        expect(data.nature).toBe('position');
        expect(data.root).toEqual({
            id: 'a-owner',
            name: 'Owner',
            type: 'LIABILITY',
            color: 'yellow',
        });
        expect(data.answer).toEqual({ amount: '2110', previous: '1110', change: '0.9009' });
        expect(data.breakdown).toEqual([]);
        expect(data.query).toBe("account:'Owner' before:$d+1 by:m");
        expect(data.chart).toMatchObject({
            kind: 'line',
            series: [
                { id: 'a-owner', amounts: [...Array(7).fill('1110'), ...Array(4).fill('2110')] },
            ],
        });
    });

    it('never shows zero for an account in no group that Bkper’s answer leaves out', async () => {
        // Bkper answers no balances at all when it does not find an account by its name, as
        // for some accounts of older Books; one it finds comes back, at zero or not.
        const ledger = fixtureLedger();
        const snapshot = await ledgerSnapshot(ledger);
        const request = intent('a-owner', 'last_month');
        const balances = balancesOf(request, snapshot, ledger);
        delete balances[0].accounts.Owner;
        expect(() => buildReport(request, snapshot, balances)).toThrow(MissingBalancesError);

        // An archived account Bkper leaves out at zero is zero.
        snapshot.ungrouped['a-owner'].archived = true;
        expect(buildReport(request, snapshot, balances).answer.amount).toBe('0');
    });

    it('rejects a target that is not under its root', async () => {
        const snapshot = await fixtureSnapshot();
        const targets: [string, string][] = [
            ['g-expenses', 'missing'],
            // In the Book, under another root.
            ['g-expenses', 'a-salary'],
            ['g-expenses', 'g-banks'],
            // The root itself, which an intent names without a target.
            ['g-assets', 'g-assets'],
            ['net-result', 'a-rent'],
            ['a-owner', 'a-owner'],
            ['g-expenses', 'a-owner'],
        ];
        for (const [root, target] of targets) {
            expect(
                () => planReport(intent(root, 'last_month', { target }), snapshot),
                `${root} ${target}`
            ).toThrow(expect.objectContaining({ reason: 'unknown_target' }));
        }
    });

    it('rejects an account in a group as a root', async () => {
        const snapshot = await fixtureSnapshot();
        expect(() => planReport(intent('a-rent', 'last_month'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'unknown_root' })
        );
    });
});

/** A group of the Book, as the Bkper API returns it. */
function groupPayload(
    id: string,
    name: string,
    nature: Pick<bkper.Group, 'type' | 'mixed' | 'credit' | 'permanent'>
): bkper.Group {
    return {
        id,
        name,
        normalizedName: name.toLowerCase(),
        hidden: false,
        locked: false,
        ...nature,
    };
}

/** The simple roots, with an Outgoing root of their own that shares Food with Expenses. */
function sharedAccountLedger(): FakeLedger {
    const ledger = simpleRootsLedger();
    ledger.addGroup(
        groupPayload('g-travel', 'Travel', { type: 'OUTGOING', credit: false, permanent: false }),
        ['a-food']
    );
    return ledger;
}

describe('buildReport: targets side by side', () => {
    const plan = async (request: ReportIntent, ledger: FakeLedger = fixtureLedger()) =>
        planQueries(planReport(request, await ledgerSnapshot(ledger)));
    /** Each target's name and amounts, in the order shown. */
    const shown = (data: ReportData) =>
        (data.targets ?? []).map(
            row =>
                `${row.name} ${row.amount} (prev ${row.previous ?? '-'}, share ${row.share ?? '-'})`
        );
    /** The amount a report of one subject alone shows. */
    const alone = async (root: string, period: string, extra: Partial<ReportIntent> = {}) =>
        (await report(intent(root, period, extra))).answer;

    it('shares the queries of targets read from the same group, and no others', async () => {
        // Bank A and Bank B are both read from Banks: one query of the period, one before.
        const shared = intent('g-assets', 'today', {
            target: 'a-bank-a',
            alongside: [{ root: 'g-assets', target: 'a-bank-b' }],
        });
        expect(await plan(shared)).toEqual([
            "group:'Banks' before:$d+1 by:m",
            "group:'Banks' before:$m by:m",
        ]);
        // Cash is read from Assets and Bank A from Banks: one query each, in parallel, though
        // both are under Assets.
        const apart = intent('g-assets', 'today', {
            target: 'a-cash',
            alongside: [{ root: 'g-assets', target: 'a-bank-a' }],
        });
        expect(await plan(apart)).toEqual([
            "group:'Assets' before:$d+1 by:m",
            "group:'Assets' before:$m by:m",
            "group:'Banks' before:$d+1 by:m",
            "group:'Banks' before:$m by:m",
        ]);
        const data = await report(apart);
        expect(data.targets?.map(row => row.amount)).toEqual([
            (await alone('g-assets', 'today', { target: 'a-cash' })).amount,
            (await alone('g-assets', 'today', { target: 'a-bank-a' })).amount,
        ]);
        expect(data.targets?.map(row => row.amount)).toEqual(['100', '7749.25']);
    });

    it('reads targets under one root from its queries, once, each with its own amount', async () => {
        const request = intent('g-expenses', 'last_month', {
            target: 'a-food',
            alongside: [{ root: 'g-expenses', target: 'a-rent' }],
        });
        expect(await plan(request)).toEqual(await plan(intent('g-expenses', 'last_month')));

        const data = await report(request);
        expect(data.nature).toBe('activity');
        // In the order asked for, not by size, with no share of a whole and no total.
        expect(shown(data)).toEqual([
            'Food 200.5 (prev 0, share -)',
            'Rent 1000 (prev 0, share -)',
        ]);
        expect(data.root).toBeUndefined();
        expect(data.answer).toBeUndefined();
        expect(data.calculated).toBeUndefined();
        expect(data.breakdown).toBe(data.targets);
        expect(data.query).toBe("(account:'Food' OR account:'Rent') on:$m-1 by:m");
        for (const [row, target] of [
            [data.targets?.[0], 'a-food'],
            [data.targets?.[1], 'a-rent'],
        ] as const) {
            expect(row?.amount).toBe((await alone('g-expenses', 'last_month', { target })).amount);
        }
    });

    it('shows the same report, in the order asked for, whichever comes first', async () => {
        const forward = await report(
            intent('g-expenses', '2026', {
                target: 'a-food',
                alongside: [{ root: 'g-expenses', target: 'a-rent' }],
            })
        );
        const backward = await report(
            intent('g-expenses', '2026', {
                target: 'a-rent',
                alongside: [{ root: 'g-expenses', target: 'a-food' }],
            })
        );
        expect(shown(backward)).toEqual([...shown(forward)].reverse());
        // Ranked bars rank by size, whatever the order asked for.
        expect(viewOf(forward, 'ranked-bar').rows).toEqual(['a-rent', 'a-food']);
        expect(viewOf(backward, 'ranked-bar').rows).toEqual(['a-rent', 'a-food']);
    });

    it('reads targets of different roots with one query each, in parallel', async () => {
        const request = intent('g-expenses', 'last_month', {
            alongside: [{ root: 'g-revenue' }, { root: 'g-expenses', target: 'a-rent' }],
        });
        expect(await plan(request)).toEqual([
            "group:'Expenses' on:$m-1 by:m",
            "group:'Expenses' on:$m-2 by:m",
            "group:'Revenue' on:$m-1 by:m",
            "group:'Revenue' on:$m-2 by:m",
        ]);
        const data = await report(request);
        // Expenses is Rent's parent: each is its own Bkper balance, side by side.
        expect(shown(data)).toEqual([
            'Expenses 1200.5 (prev 0, share -)',
            'Revenue 5000 (prev 0, share -)',
            'Rent 1000 (prev 0, share -)',
        ]);
        expect(data.targets?.[0].amount).toBe((await alone('g-expenses', 'last_month')).amount);
        expect(data.targets?.[1].amount).toBe((await alone('g-revenue', 'last_month')).amount);
        // A group keeps the rows Bkper lists under it, with their shares of it.
        expect(rows(data.targets?.[0].children ?? [])).toEqual([
            'Rent 1000 (prev 0, change -, share 0.833)',
            'Food 200.5 (prev 0, change -, share 0.167)',
        ]);
        expect(data.query).toBe(
            "(group:'Expenses' OR group:'Revenue' OR account:'Rent') on:$m-1 by:m"
        );
    });

    it('adds nothing up: no amount of the report is a sum of its targets', async () => {
        const data = await report(
            intent('g-expenses', '2026', {
                monthly: true,
                target: 'a-food',
                alongside: [{ root: 'g-expenses', target: 'a-rent' }, { root: 'g-revenue' }],
            })
        );
        const targets = data.targets ?? [];
        expect(targets).toHaveLength(3);
        // Every value one target has of its own, which a sum may equal by chance.
        const own = new Set(
            targets.flatMap(row => [row.amount, row.previous ?? '0', ...row.months])
        );
        const sums = new Set<string>();
        const subsets = [
            [0, 1],
            [0, 2],
            [1, 2],
            [0, 1, 2],
        ];
        for (const subset of subsets) {
            const part = subset.map(index => targets[index]);
            const candidates = [
                total(part.map(row => row.amount)),
                total(part.map(row => row.previous)),
                ...data.months.map((_, month) => total(part.map(row => row.months[month]))),
            ];
            candidates
                .map(sum => sum.toFixed())
                .filter(sum => !own.has(sum))
                .forEach(sum => sums.add(sum));
        }
        expect(sums.size).toBeGreaterThan(0);
        const shownAmounts = JSON.stringify(data, (key, value: unknown) =>
            key === 'children' ? undefined : value
        );
        for (const sum of sums) {
            expect(shownAmounts).not.toContain(`"${sum}"`);
        }
        // Each series by month is one target's own.
        expect(data.chart).toMatchObject({ kind: 'bar' });
        const series = data.chart.kind === 'bar' ? data.chart.series : [];
        expect(series.map(entry => entry.id)).toEqual(['a-food', 'a-rent', 'g-revenue']);
        expect(series.map(entry => entry.amounts)).toEqual(targets.map(row => row.months));
    });

    it('offers only charts that imply no whole', async () => {
        const request = intent('g-expenses', '2026', {
            monthly: true,
            target: 'a-food',
            alongside: [{ root: 'g-expenses', target: 'a-rent' }],
        });
        const data = await report(request);
        expect(kinds(data)).toEqual(['bar', 'area', 'ranked-bar', 'compare', 'table']);
        expect(data.charts.facts).toMatchObject({ rows: 2, sideBySide: true, net: false });
        for (const chart of ['pie', 'donut', 'stacked'] as const) {
            const preferred = await report({ ...request, chart });
            expect(preferred.charts.unfit, chart).toEqual({
                kind: chart,
                reason: { code: 'side_by_side' },
            });
            expect(preferred.chart.fallback).toBe(true);
        }
        const bridge = await report({ ...request, chart: 'waterfall' });
        expect(bridge.charts.unfit).toEqual({ kind: 'waterfall', reason: { code: 'no_bridge' } });
        expect(bridge.charts.main).toBe('compare');
        // With no view or chart asked for, ranked bars of the targets.
        expect((await report({ ...request, monthly: false })).charts.main).toBe('ranked-bar');
    });

    it('reads an account in no group and a root position side by side', async () => {
        const request = intent('a-owner', 'today', { alongside: [{ root: 'g-card' }] });
        // Each root's queries, exactly those of its own report.
        expect(await plan(request)).toEqual([
            ...(await plan(intent('a-owner', 'today'))),
            ...(await plan(intent('g-card', 'today'))),
        ]);
        expect(await plan(request)).toEqual([
            "account:'Owner' before:$d+1 by:m",
            "account:'Owner' before:$m by:m",
            "group:'Card' before:$d+1 by:m",
            "group:'Card' before:$m by:m",
        ]);
        const data = await report(request);
        expect(data.nature).toBe('position');
        expect(data.targets?.map(row => row.amount)).toEqual([
            (await alone('a-owner', 'today')).amount,
            (await alone('g-card', 'today')).amount,
        ]);
        expect(data.query).toBe("(account:'Owner' OR group:'Card') before:$d+1 by:m");
    });

    it('filters every root’s queries by the hashtags', async () => {
        const request = intent('g-expenses', 'last_month', {
            target: 'a-food',
            alongside: [{ root: 'g-revenue' }],
            hashtags: ['trip'],
        });
        expect(await plan(request)).toEqual([
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
            "group:'Revenue' #trip on:$m-1 by:m",
            "group:'Revenue' #trip on:$m-2 by:m",
        ]);
        const data = await report(request);
        expect(data.targets?.map(row => row.amount)).toEqual(['200.5', '0']);
        expect(data.query).toBe("(account:'Food' OR group:'Revenue') #trip on:$m-1 by:m");
    });

    it('shows a target asked for twice once, as the report of it alone', async () => {
        const single = intent('g-expenses', 'last_month', { target: 'a-rent' });
        // Rent is under Expenses and Net income: the same account, from either root.
        const request = {
            ...single,
            alongside: [
                { root: 'g-net', target: 'a-rent' },
                { root: 'g-expenses', target: 'a-rent' },
            ],
        };
        expect(await plan(request)).toEqual(await plan(single));
        const data = await report(request);
        const { intent: _intent, ...rest } = data;
        const { intent: _single, ...own } = await report(single);
        expect(rest).toEqual(own);

        const repeated = await report({
            ...intent('g-expenses', 'last_month'),
            alongside: [{ root: 'g-revenue' }, { root: 'g-expenses' }],
        });
        expect(shown(repeated)).toEqual([
            'Expenses 1200.5 (prev 0, share -)',
            'Revenue 5000 (prev 0, share -)',
        ]);
    });

    it('needs targets of one kind: activity or positions', async () => {
        const snapshot = await fixtureSnapshot();
        const mixed: ReportIntent[] = [
            intent('g-expenses', 'last_month', { alongside: [{ root: 'g-assets' }] }),
            intent('g-expenses', 'last_month', {
                target: 'a-rent',
                alongside: [{ root: 'g-assets', target: 'a-bank-a' }],
            }),
            intent('a-owner', 'last_month', { alongside: [{ root: 'g-revenue' }] }),
        ];
        for (const request of mixed) {
            expect(() => planReport(request, snapshot)).toThrow(
                expect.objectContaining({ reason: 'mixed_targets' })
            );
        }
    });

    it('rejects a net result or a target not under its root among them', async () => {
        const snapshot = await fixtureSnapshot();
        const cases: [ReportIntent, string][] = [
            [
                intent('net-result', 'last_month', { alongside: [{ root: 'g-expenses' }] }),
                'unknown_target',
            ],
            [
                intent('g-expenses', 'last_month', { alongside: [{ root: 'net-result' }] }),
                'unknown_target',
            ],
            [
                intent('g-expenses', 'last_month', {
                    alongside: [{ root: 'g-expenses', target: 'a-salary' }],
                }),
                'unknown_target',
            ],
            [
                intent('g-expenses', 'last_month', { alongside: [{ root: 'missing' }] }),
                'unknown_root',
            ],
            [
                intent('g-expenses', 'last_month', { alongside: [{ root: 'a-rent' }] }),
                'unknown_root',
            ],
        ];
        for (const [request, reason] of cases) {
            expect(() => planReport(request, snapshot), JSON.stringify(request)).toThrow(
                expect.objectContaining({ reason })
            );
        }
    });
});

describe('buildReport: mixed groups', () => {
    it('shows the rows of a mixed group as Bkper returns them, without changing their signs', async () => {
        const data = await report(intent('g-net', 'last_month'));
        expect(data.nature).toBe('activity');
        expect(data.root).toMatchObject({ type: 'MIXED', color: 'grey' });
        // The group's own balance, as Bkper calculates it: Incoming minus Outgoing.
        expect(data.answer.amount).toBe('3799.5');
        // Each row with its own balance, Outgoing positive; shares of a mixed total would mislead.
        expect(rows(data.breakdown)).toEqual([
            'Salary 5000 (prev 0, change -, share -)',
            'Rent 1000 (prev 0, change -, share -)',
            'Food 200.5 (prev 0, change -, share -)',
        ]);
        expect(data.breakdown.map(row => row.color)).toEqual(['green', 'red', 'red']);
        expect(data.calculated).toBeUndefined();
        expect(data.chart).toEqual({ kind: 'ranked-bar', rows: ['a-salary', 'a-rent', 'a-food'] });
    });

    it('shows a mixed position as Bkper returns it, each row with its own balance', async () => {
        const ledger = fixtureLedger();
        ledger.addGroup(
            groupPayload('g-worth', 'Worth', { mixed: true, credit: false, permanent: true }),
            ['a-cash', 'a-card']
        );
        ledger.transactions.push({
            date: '2026-10-20',
            from: 'Credit Card',
            to: 'Food',
            amount: '30',
        });
        const data = await report(intent('g-worth', 'today', { chart: 'pie' }), ledger);
        expect(data.nature).toBe('position');
        expect(data.answer).toEqual({ amount: '70', previous: '70', change: '0' });
        // The Liability shows positive, as Bkper shows it, not against the Asset.
        expect(rows(data.breakdown)).toEqual([
            'Cash 100 (prev 100, change 0, share -)',
            'Credit Card 30 (prev 30, change 0, share -)',
        ]);
        expect(data.charts.unfit).toEqual({ kind: 'pie', reason: { code: 'mixed_parts' } });
        expect(data.charts.facts).toMatchObject({ mixed: true, net: false, permanent: true });
    });
});

describe('planReport: a group that mixes balances with activity', () => {
    /** The fixture Book with Salary also under Assets, which then holds balances and activity. */
    function mixedAssetsLedger(): FakeLedger {
        const ledger = fixtureLedger();
        for (const account of ledger.book.accounts ?? []) {
            if (account.id === 'a-salary') {
                account.groups = [...(account.groups ?? []), { id: 'g-banks' }];
            }
        }
        return ledger;
    }
    const mixedGroup = (group: string) =>
        expect.objectContaining({
            reason: 'mixed_group',
            problem: expect.objectContaining({ code: 'mixed_group', group }),
        });

    it('rejects a report of the group, before any query', async () => {
        const snapshot = await ledgerSnapshot(mixedAssetsLedger());
        expect(() => planReport(intent('g-assets', 'today'), snapshot)).toThrow(
            mixedGroup('Assets')
        );
        expect(() =>
            planReport(intent('g-assets', 'today', { target: 'g-banks' }), snapshot)
        ).toThrow(mixedGroup('Banks'));
        expect(() =>
            planReport(intent('g-card', 'today', { alongside: [{ root: 'g-assets' }] }), snapshot)
        ).toThrow(mixedGroup('Assets'));
    });

    it('reads the accounts under it, and the other roots, as before', async () => {
        const snapshot = await ledgerSnapshot(mixedAssetsLedger());
        expect(
            planReport(intent('g-assets', 'today', { target: 'a-cash' }), snapshot).sources
        ).toEqual(['g-assets']);
        expect(planReport(intent('g-card', 'today'), snapshot).sources).toEqual(['g-card']);
        expect(planReport(intent('g-expenses', 'last_month'), snapshot).sources).toEqual([
            'g-expenses',
        ]);
    });

    it('rejects the net result of a combining group that also holds balances', async () => {
        const ledger = fixtureLedger();
        for (const account of ledger.book.accounts ?? []) {
            if (account.id === 'a-cash') {
                account.groups = [...(account.groups ?? []), { id: 'g-net' }];
            }
        }
        const snapshot = await ledgerSnapshot(ledger);
        expect(() => planReport(intent('net-result', 'last_month'), snapshot)).toThrow(
            mixedGroup('Net income')
        );
    });
});

describe('buildReport: net result from a group that combines Incoming and Outgoing', () => {
    it('reads the net result Bkper calculates for the group, and its rows', async () => {
        const data = await report(intent('net-result', 'all'));
        expect(data.intent.root).toBe('net-result');
        expect(data.root).toEqual({
            id: 'g-net',
            name: 'Net income',
            type: 'MIXED',
            color: 'grey',
        });
        // Old Supplier is under Expenses only.
        expect(data.answer).toEqual({ amount: '5749.25' });
        expect(rows(data.breakdown)).toEqual([
            'Salary 10000 (prev -, change -, share -)',
            'Rent 4000 (prev -, change -, share -)',
            'Food 250.75 (prev -, change -, share -)',
        ]);
        expect(data.calculated).toBeUndefined();
        expect(data.query).toBe("group:'Net income' before:$m+1 by:m");
        // The same report as the group's own.
        const group = await report(intent('g-net', 'all'));
        expect({ ...data, intent: group.intent }).toEqual(group);
    });

    it('reads the combining group with the most accounts, the first in Book order on a tie', async () => {
        const ledger = fixtureLedger();
        ledger.addGroup(
            groupPayload('g-food-net', 'Food and salary', {
                mixed: true,
                credit: true,
                permanent: false,
            }),
            ['a-food', 'a-salary']
        );
        const snapshot = await ledgerSnapshot(ledger);
        expect(planReport(intent('net-result', 'last_month'), snapshot).sources).toEqual(['g-net']);
    });

    it('fits no pie, donut or stacked parts, as for any net result', async () => {
        const data = await report(intent('g-net', '2026', { monthly: true, chart: 'pie' }));
        expect(data.charts.unfit).toEqual({ kind: 'pie', reason: { code: 'net_result' } });
        expect(kinds(data)).toEqual(['bar', 'area', 'ranked-bar', 'compare', 'table']);
        expect(data.charts.facts).toMatchObject({ mixed: true, net: true });
    });
});

describe('buildReport: net result Report calculates from simple roots', () => {
    it('subtracts the Outgoing roots from the Incoming roots, each as Bkper returns it', async () => {
        const ledger = simpleRootsLedger();
        const data = await report(intent('net-result', 'all'), ledger);
        expect(data.root).toEqual({ id: 'net-result', type: 'MIXED', color: 'grey' });
        expect(data.answer).toEqual({ amount: '5739.25' });
        // The roots are Bkper's own rows, Incoming first, each with its own balance and rows.
        expect(rows(data.breakdown)).toEqual([
            'Revenue 10000 (prev -, change -, share -)',
            '  Salary 10000 (prev -, change -, share 1)',
            'Expenses 4260.75 (prev -, change -, share -)',
            '  Rent 4000 (prev -, change -, share 0.9388)',
            '  Food 250.75 (prev -, change -, share 0.0589)',
            '  Old Supplier 10 (prev -, change -, share 0.0023)',
        ]);
        expect(data.breakdown.map(row => [row.id, row.kind, row.type, row.color])).toEqual([
            ['g-revenue', 'group', 'INCOMING', 'green'],
            ['g-expenses', 'group', 'OUTGOING', 'red'],
        ]);
        for (const row of data.breakdown) {
            expect(row.amount).toBe((await report(intent(row.id, 'all'), ledger)).answer.amount);
        }
        expect(data.calculated).toEqual({ months: expect.any(Array) });
        expect(data.query).toBe("(group:'Expenses' OR group:'Revenue') before:$m+1 by:m");
    });

    it('compares the net result with the previous period and shows it by month', async () => {
        const data = await report(
            intent('net-result', 'this_month', { monthly: true }),
            simpleRootsLedger()
        );
        expect(data.answer).toEqual({ amount: '3949.75', previous: '3799.5', change: '0.0395' });
        expect(data.calculated).toEqual({ months: ['3949.75'] });
        expect(rows(data.breakdown).filter(row => !row.startsWith(' '))).toEqual([
            'Revenue 5000 (prev 5000, change 0, share -)',
            'Expenses 1050.25 (prev 1200.5, change -0.1252, share -)',
        ]);
        expect(data.chart).toEqual({
            kind: 'bar',
            series: [
                {
                    id: 'g-revenue',
                    name: 'Revenue',
                    type: 'INCOMING',
                    color: 'green',
                    amounts: ['5000'],
                },
                {
                    id: 'g-expenses',
                    name: 'Expenses',
                    type: 'OUTGOING',
                    color: 'red',
                    amounts: ['1050.25'],
                },
                {
                    id: 'net-result',
                    type: 'MIXED',
                    color: 'grey',
                    line: true,
                    amounts: ['3949.75'],
                },
            ],
        });
    });

    it('subtracts the Outgoing roots from the Incoming roots in every month', async () => {
        const data = await report(
            intent('net-result', 'last_12_months', { monthly: true }),
            simpleRootsLedger()
        );
        const [revenue, expenses] = data.breakdown;
        expect(data.calculated?.months).toEqual(
            data.months.map((_, i) =>
                new Amount(revenue.months[i]).minus(expenses.months[i]).toFixed()
            )
        );
        expect(data.calculated?.months.slice(-2)).toEqual(['3799.5', '3949.75']);
    });

    it('leaves a root without amount out of the chart', async () => {
        const ledger = simpleRootsLedger();
        const data = await report(intent('net-result', '2026-09', { monthly: true }), ledger);
        expect(rows(data.breakdown)).toEqual([
            'Expenses 0 (prev 1000, change -1, share -)',
            '  Rent 0 (prev 1000, change -1, share -)',
        ]);
        // Nothing has an amount in any month, so there is no chart at all.
        expect(data.chart).toEqual({ kind: 'none' });
        const year = await report(intent('net-result', 'last_year', { monthly: true }), ledger);
        expect(year.chart.kind === 'bar' && year.chart.series.map(series => series.id)).toEqual([
            'g-expenses',
            'net-result',
        ]);
    });

    it('reads a net result today from each root, in this month', async () => {
        const data = await report(intent('net-result', 'today'), simpleRootsLedger());
        expect(rows(data.breakdown).filter(row => !row.startsWith(' '))).toEqual([
            'Revenue 5000 (prev 5000, change 0, share -)',
            'Expenses 1050.25 (prev 1200.5, change -0.1252, share -)',
        ]);
        expect(data.answer).toMatchObject({ amount: '3949.75', previous: '3799.5' });
    });

    it('fits no pie, donut or stacked parts', async () => {
        const data = await report(
            intent('net-result', '2026', { monthly: true }),
            simpleRootsLedger()
        );
        expect(kinds(data)).toEqual(['bar', 'area', 'ranked-bar', 'compare', 'table']);
        expect(data.charts.facts).toMatchObject({ rows: 2, mixed: true, net: true });
    });

    it('has no net result when the responses show roots sharing an account', async () => {
        const ledger = simpleRootsLedger();
        const snapshot = await ledgerSnapshot(ledger);
        const request = intent('net-result', 'last_month');
        const balances = balancesOf(request, snapshot, ledger);
        // An account the map does not show under Revenue, as when it was archived at zero.
        const revenue = balances.filter(entry => entry.query.startsWith("group:'Revenue'"));
        for (const entry of revenue) {
            entry.accounts.Food = { ...balances[0].accounts.Food };
            entry.groups.Revenue.accounts.push('Food');
        }
        expect(() => buildReport(request, snapshot, balances)).toThrow(
            expect.objectContaining({ reason: 'no_net_result' })
        );
    });
});

describe('buildReport: no net result', () => {
    it('has none when activity roots share accounts', async () => {
        const snapshot = await ledgerSnapshot(sharedAccountLedger());
        expect(() => planReport(intent('net-result', 'last_month'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'no_net_result' })
        );
    });

    it('has none without both an Incoming and an Outgoing root', async () => {
        const ledger = simpleRootsLedger();
        ledger.removeGroup('g-revenue');
        const snapshot = await ledgerSnapshot(ledger);
        expect(() => planReport(intent('net-result', 'last_month'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'no_net_result' })
        );
    });

    it('tells which activity roots it found, and which share accounts', async () => {
        const snapshot = await ledgerSnapshot(sharedAccountLedger());
        expect(() => planReport(intent('net-result', 'last_month'), snapshot)).toThrow(
            expect.objectContaining({
                reason: 'no_net_result',
                problem: expect.objectContaining({
                    code: 'no_net_result',
                    incoming: ['Revenue'],
                    outgoing: ['Expenses', 'Travel'],
                    shared: ['Expenses', 'Travel'],
                }),
            })
        );
    });

    it('rejects a net result in a Book without activity roots', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.roots = snapshot.roots.filter(id => snapshot.groups[id].permanent);
        expect(() => planReport(intent('net-result', 'last_month'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'no_activity_roots' })
        );
    });
});

describe('buildReport: only the rows Bkper returns', () => {
    it('shows no row Bkper left out, and no remainder in its place', async () => {
        const ledger = fixtureLedger();
        const snapshot = await ledgerSnapshot(ledger);
        const request = intent('g-expenses', 'all', { chart: 'pie' });
        const balances = balancesOf(request, snapshot, ledger);
        for (const entry of balances) {
            delete entry.accounts.Food;
            entry.groups.Expenses.accounts = entry.groups.Expenses.accounts.filter(
                name => name !== 'Food'
            );
        }
        const data = buildReport(request, snapshot, balances);
        // The group's own total still counts Food, as Bkper's does.
        expect(data.answer.amount).toBe('4260.75');
        expect(rows(data.breakdown)).toEqual([
            'Rent 4000 (prev -, change -, share 0.9388)',
            'Old Supplier 10 (prev -, change -, share 0.0023)',
        ]);
        // The parts are no whole of the total, so no chart implies they are.
        expect(data.charts.unfit).toEqual({ kind: 'pie', reason: { code: 'not_a_whole' } });
        expect(kinds(data)).not.toContain('donut');
        expect(data.chart).toMatchObject({ kind: 'ranked-bar', fallback: true });
    });

    it('shows a row Bkper returns that the map lacks, with its own nature', async () => {
        const ledger = fixtureLedger();
        const snapshot = await ledgerSnapshot(ledger);
        delete snapshot.accounts['a-food'];
        snapshot.groups['g-expenses'].accounts = ['a-rent', 'a-old'];
        const data = await report(intent('g-expenses', 'last_month'), ledger, snapshot);
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 0, change -, share 0.833)',
            'Food 200.5 (prev 0, change -, share 0.167)',
        ]);
        expect(data.breakdown[1]).toMatchObject({
            id: 'account:Food',
            kind: 'account',
            type: 'OUTGOING',
            color: 'red',
            months: ['200.5'],
        });
    });
});

/** Adds an Expenses account that moved only in September 2026. */
function withSeptemberOnly(ledger: FakeLedger): FakeLedger {
    ledger.addAccount({
        id: 'a-september',
        name: 'September Only',
        type: 'OUTGOING',
        groups: ['g-expenses'],
    });
    ledger.transactions.push({
        date: '2026-09-10',
        from: 'Owner',
        to: 'September Only',
        amount: '5',
    });
    return ledger;
}

describe('buildReport: rows without amount', () => {
    it('keeps them in the table, last, and leaves them out of breakdown charts', async () => {
        const ledger = withSeptemberOnly(fixtureLedger());
        const data = await report(intent('g-expenses', 'last_month'), ledger);
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 0, change -, share 0.833)',
            'Food 200.5 (prev 0, change -, share 0.167)',
            'September Only 0 (prev 5, change -1, share 0)',
        ]);
        expect(data.chart).toEqual({ kind: 'donut', rows: ['a-rent', 'a-food'] });
    });

    it('needs two rows with amounts for a breakdown chart', async () => {
        const ledger = withSeptemberOnly(fixtureLedger());
        ledger.transactions.splice(
            ledger.transactions.findIndex(
                transaction => transaction.to === 'Food' && transaction.date === '2026-10-15'
            ),
            1
        );
        const data = await report(
            intent('g-expenses', 'last_month', { view: 'breakdown' }),
            ledger
        );
        expect(data.breakdown.map(row => row.name)).toEqual(['Rent', 'September Only']);
        expect(data.chart).toEqual({ kind: 'none' });
    });
});

describe('buildReport: chart', () => {
    it('follows the named view first', async () => {
        const total = await report(
            intent('g-expenses', 'last_month', { monthly: true, view: 'total' })
        );
        expect(total.chart).toEqual({ kind: 'none' });
        const breakdown = await report(
            intent('g-expenses', 'last_month', { monthly: true, view: 'breakdown' })
        );
        expect(breakdown.chart.kind).toBe('donut');
        const trend = await report(intent('g-expenses', 'last_month', { view: 'trend' }));
        expect(trend.chart.kind).toBe('bar');
    });

    it('draws no chart by month whose every value is zero, as charts leave out empty rows', async () => {
        const empty = await report(intent('g-card', 'last_year', { monthly: true }));
        expect(empty.months).toHaveLength(12);
        expect(empty.chart).toEqual({ kind: 'none' });
        // A single month with an amount is enough.
        const expenses = await report(intent('g-expenses', 'last_year', { monthly: true }));
        expect(expenses.chart.kind).toBe('bar');
    });

    it('needs two rows for a breakdown chart', async () => {
        const data = await report(intent('g-revenue', 'last_month'));
        expect(data.breakdown).toHaveLength(1);
        expect(data.chart).toEqual({ kind: 'none' });
    });

    it('ranks more than six rows in bars', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', [
            '1',
            '1',
            '1',
            '1',
            '1',
            '1',
        ]);
        const data = await report(intent('g-expenses', 'last_month'), ledger);
        expect(data.breakdown).toHaveLength(8);
        expect(data.breakdown.every(row => row.kind === 'account')).toBe(true);
        expect(data.chart.kind).toBe('ranked-bar');
    });
});

describe('buildReport: any period and hashtags', () => {
    it('takes the days each side read from Bkper, in any date format', async () => {
        for (const pattern of ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd']) {
            const ledger = fixtureLedger();
            ledger.book.datePattern = pattern;
            const activity = await report(intent('g-expenses', 'this_quarter'), ledger);
            expect(activity.period, pattern).toEqual({
                after: '2026-10-01',
                before: '2026-12-01',
                dates: 'after:2026-10 before:2026-12 by:m',
                kind: 'quarter',
            });
            expect(activity.previous, pattern).toEqual({
                after: '2026-07-01',
                before: '2026-09-01',
                dates: 'after:2026-07 before:2026-09 by:m',
                kind: 'quarter',
            });
            const position = await report(intent('g-assets', 'today'), ledger);
            expect(position.period, pattern).toMatchObject({ before: '2026-11-06' });
            expect(position.previous, pattern).toMatchObject({ before: '2026-11-01' });
        }
    });

    it('labels a period with the days Bkper says it read, not the days it was asked', async () => {
        const request = intent('g-expenses', 'last_month');
        const snapshot = await fixtureSnapshot();
        const balances = balancesOf(request, snapshot, fixtureLedger()).map(entry =>
            entry.query.includes('on:$m-1 ')
                ? { ...entry, rangeBeginLabel: '15/09/2026', rangeEndLabel: '14/10/2026' }
                : entry
        );
        const data = buildReport(request, snapshot, balances);
        expect(data.period).toMatchObject({ after: '2026-09-15', before: '2026-10-15' });
        expect(data.previous).toMatchObject({ after: '2026-09-01', before: '2026-10-01' });
    });

    it('resolves the dates of answers without labels in the Book format as Bkper does', async () => {
        const request = intent('g-expenses', 'this_year');
        const snapshot = await fixtureSnapshot();
        const balances = balancesOf(request, snapshot, fixtureLedger()).map(
            ({ rangeBeginLabel: _begin, rangeEndLabel: _end, ...entry }) => entry
        );
        const data = buildReport(request, snapshot, balances);
        expect(data.period).toMatchObject({ after: '2026-01-01', before: '2026-12-01' });
        expect(data.previous).toMatchObject({ after: '2025-01-01', before: '2025-12-01' });
        const unknown = { ...snapshot, book: { ...snapshot.book, datePattern: 'd.M.yyyy' } };
        const position = intent('g-assets', 'today');
        const read = buildReport(position, unknown, balancesOf(position, unknown, fixtureLedger()));
        expect(read.period).toMatchObject({ before: '2026-11-06' });
    });

    it('reads activity today as this month, against the month before', async () => {
        const data = await report(intent('g-expenses', 'today'));
        expect(data.period).toEqual({
            after: '2026-11-01',
            before: '2026-12-01',
            dates: 'on:$m by:m',
            kind: 'now',
        });
        expect(data.previous).toEqual({
            after: '2026-10-01',
            before: '2026-11-01',
            dates: 'on:$m-1 by:m',
            kind: 'now',
        });
        expect(data.answer).toEqual({ amount: '1050.25', previous: '1200.5', change: '-0.1252' });
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 1000, change 0, share 0.9522)',
            'Food 50.25 (prev 200.5, change -0.7494, share 0.0478)',
        ]);
        expect(data.query).toBe("group:'Expenses' on:$m by:m");
    });

    it('reads hashtag reports from queries filtered by the hashtags', async () => {
        const data = await report(intent('g-expenses', 'last_month', { hashtags: ['trip'] }));
        expect(data.answer).toEqual({ amount: '200.5', previous: '0' });
        expect(rows(data.breakdown)).toEqual(['Food 200.5 (prev 0, change -, share 1)']);
        expect(data.query).toBe("group:'Expenses' #trip on:$m-1 by:m");
        const month = await report(intent('g-expenses', 'this_month', { hashtags: ['trip'] }));
        expect(month.answer).toEqual({ amount: '1000', previous: '200.5', change: '3.9875' });
    });

    it('reads a position with hashtags from the cumulative balance of its movements', async () => {
        const data = await report(intent('g-assets', 'today', { hashtags: ['trip'] }));
        // Bank A paid both #trip transactions, 200.5 in October and 1000 in November.
        expect(data.answer).toEqual({ amount: '-1200.5', previous: '-200.5', change: '-4.9875' });
        const quarter = await report(
            intent('g-assets', '2026-Q4', { monthly: true, hashtags: ['trip'] })
        );
        expect(quarter.months).toEqual(['2026-10', '2026-11']);
        expect(quarter.chart).toMatchObject({
            kind: 'line',
            series: [{ amounts: ['-200.5', '-1200.5'] }],
        });
        expect(quarter.answer).toMatchObject({ amount: '-1200.5', previous: '0' });
    });
});

/**
 * Adds accounts to a group, each moving `amount` in `month` (in the sign Bkper shows) with
 * `Owner`, which is in no group, on the first of the month.
 */
function withAccounts(
    ledger: FakeLedger,
    groupId: string,
    month: string,
    amounts: string[]
): FakeLedger {
    const type = groupId === 'g-assets' ? 'ASSET' : 'OUTGOING';
    amounts.forEach((amount, i) => {
        const name = `Extra ${i}`;
        ledger.addAccount({ id: `${groupId}-extra-${i}`, name, type, groups: [groupId] });
        // Both types have a debit nature: what arrives in the account shows positive.
        const value = new Amount(amount);
        ledger.transactions.push({
            date: `${month}-01`,
            from: value.gt(0) ? 'Owner' : name,
            to: value.gt(0) ? name : 'Owner',
            amount: value.abs().toFixed(),
        });
    });
    return ledger;
}

function total(values: (string | undefined)[]): Amount {
    return values.reduce((sum, value) => sum.plus(value ?? 0), new Amount(0));
}

describe('buildReport: chart preference', () => {
    it('reads intents without a chart, or with auto, exactly as before', async () => {
        const intents = [
            intent('g-expenses', 'last_month'),
            intent('g-expenses', '2026', { monthly: true }),
            intent('g-assets', 'today'),
            intent('g-net', 'last_month', { view: 'breakdown' }),
            intent('net-result', 'this_month', { monthly: true }),
        ];
        for (const request of intents) {
            const auto = await report({ ...request, chart: 'auto' });
            const plain = await report(request);
            expect({ ...auto, intent: plain.intent }).toEqual(plain);
            expect(auto.chart.fallback).toBeUndefined();
        }
    });

    it('shows no chart for a table, whatever the report', async () => {
        for (const request of [
            intent('g-expenses', '2026', { monthly: true, chart: 'table' }),
            intent('net-result', 'last_month', { chart: 'table' }),
        ]) {
            expect((await report(request)).chart).toEqual({ kind: 'none' });
        }
    });

    it('draws a pie of parts that are all positive', async () => {
        const data = await report(intent('g-expenses', 'last_month', { chart: 'pie' }));
        expect(data.chart).toEqual({ kind: 'pie', rows: ['a-rent', 'a-food'] });
    });

    it('falls back from a pie to the rules for a mixed group or a net result', async () => {
        const mixed = await report(intent('g-net', 'last_month', { chart: 'pie' }));
        expect(mixed.chart).toEqual({
            kind: 'ranked-bar',
            rows: ['a-salary', 'a-rent', 'a-food'],
            fallback: true,
        });
        const net = await report(intent('net-result', 'last_month', { chart: 'pie' }));
        expect(net.chart.kind).not.toBe('pie');
        expect(net.chart.fallback).toBe(true);
    });

    it('stacks the parts by month, each a series', async () => {
        const data = await report(intent('g-expenses', '2026', { chart: 'stacked' }));
        expect(data.chart).toMatchObject({
            kind: 'stacked',
            series: [
                { id: 'a-rent', name: 'Rent', type: 'OUTGOING', color: 'red' },
                { id: 'a-food', name: 'Food', type: 'OUTGOING', color: 'red' },
            ],
        });
    });

    it('stacks at most six parts, every part drawn, adding up to the root each month', async () => {
        const request = intent('g-expenses', '2026', { monthly: true });
        const six = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', [
            '300',
            '-40',
            '25',
            '7',
        ]);
        const data = await report({ ...request, chart: 'stacked' }, six);
        const byRules = await report(request, six);
        if (data.chart.kind !== 'stacked' || byRules.chart.kind !== 'bar') {
            throw new Error(`Unexpected charts ${data.chart.kind} and ${byRules.chart.kind}`);
        }
        const { series } = data.chart;
        expect(series.map(entry => entry.name)).toEqual([
            'Rent',
            'Extra 0',
            'Food',
            'Extra 1',
            'Extra 2',
            'Extra 3',
        ]);
        // Each part is its row, as Bkper returns it.
        series.forEach(entry =>
            expect(entry.amounts).toEqual(data.breakdown.find(row => row.id === entry.id)?.months)
        );
        const rootMonths = byRules.chart.series[0].amounts;
        data.months.forEach((month, i) => {
            expect(total(series.map(entry => entry.amounts[i])).eq(rootMonths[i]), month).toBe(
                true
            );
        });
        const seven = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', [
            '300',
            '-40',
            '25',
            '7',
            '3.33',
        ]);
        const many = await report({ ...request, chart: 'stacked' }, seven);
        expect(many.charts.unfit).toEqual({ kind: 'stacked', reason: { code: 'too_many_parts' } });
        expect(many.chart).toMatchObject({ kind: 'bar', fallback: true });
    });

    it('stacks no parts of different types, nor parts that are no whole of the root', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', ['50']);
        const snapshot = await ledgerSnapshot(ledger);
        snapshot.accounts['g-expenses-extra-0'].type = 'ASSET';
        const request = intent('g-expenses', '2026', { monthly: true, chart: 'stacked' });
        const mixed = await report(request, ledger, snapshot);
        expect(mixed.charts.unfit).toEqual({ kind: 'stacked', reason: { code: 'mixed_parts' } });
        const withExtra = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', ['50']);
        const extraMap = await ledgerSnapshot(withExtra);
        const extraBalances = balancesOf(request, extraMap, withExtra);
        for (const entry of extraBalances) {
            delete entry.accounts.Food;
            entry.groups.Expenses.accounts = entry.groups.Expenses.accounts.filter(
                name => name !== 'Food'
            );
        }
        const notWhole = buildReport(request, extraMap, extraBalances);
        expect(notWhole.charts.unfit).toEqual({
            kind: 'stacked',
            reason: { code: 'not_a_whole' },
        });
    });

    it('falls back from stacked bars for one month or a net result', async () => {
        const month = await report(intent('g-expenses', 'last_month', { chart: 'stacked' }));
        expect(month.chart).toEqual({ kind: 'donut', rows: ['a-rent', 'a-food'], fallback: true });
        const net = await report(intent('net-result', '2026', { monthly: true, chart: 'stacked' }));
        expect(net.chart).toMatchObject({ kind: 'bar', fallback: true });
    });

    it('draws areas by month, with the series of the chart by month', async () => {
        const request = intent('g-assets', '2026-Q4', { monthly: true });
        const data = await report({ ...request, chart: 'area' });
        const byRules = await report(request);
        expect(data.chart).toEqual({
            kind: 'area',
            series: byRules.chart.kind === 'line' ? byRules.chart.series : [],
        });
        const net = await report(
            intent('net-result', '2026', { chart: 'area' }),
            simpleRootsLedger()
        );
        expect(net.chart.kind === 'area' && net.chart.series.map(series => series.id)).toEqual([
            'g-revenue',
            'g-expenses',
            'net-result',
        ]);
    });

    it('falls back from areas whose every value is zero, to no chart', async () => {
        const data = await report(intent('g-card', 'last_year', { monthly: true, chart: 'area' }));
        expect(data.chart).toEqual({ kind: 'none', fallback: true });
    });

    it('falls back from areas for one month', async () => {
        const data = await report(intent('g-expenses', 'last_month', { chart: 'area' }));
        expect(data.chart).toEqual({ kind: 'donut', rows: ['a-rent', 'a-food'], fallback: true });
    });

    it('compares each part with the previous period, also parts that had an amount only then', async () => {
        const data = await report(intent('g-expenses', 'this_month', { chart: 'compare' }));
        expect(data.chart).toEqual({ kind: 'compare', rows: ['a-rent', 'a-food'] });
        const net = await report(
            intent('net-result', '2026-09', { chart: 'compare' }),
            simpleRootsLedger()
        );
        expect(net.chart).toEqual({ kind: 'compare', rows: ['g-expenses'] });
    });

    it('falls back from a comparison without a previous period to the closest chart', async () => {
        const data = await report(intent('g-expenses', 'all', { chart: 'compare' }));
        expect(data.chart).toEqual({
            kind: 'ranked-bar',
            rows: ['a-rent', 'a-food', 'a-old'],
            fallback: true,
        });
    });

    it('draws no bridge, offering the closest chart and why', async () => {
        const requests = [
            intent('g-expenses', 'last_month', { chart: 'waterfall' }),
            intent('g-assets', 'today', { chart: 'waterfall' }),
            intent('net-result', 'this_month', { chart: 'waterfall' }),
        ];
        for (const request of requests) {
            const data = await report(request);
            expect(data.charts.unfit).toEqual({ kind: 'waterfall', reason: { code: 'no_bridge' } });
            expect(kinds(data)).not.toContain('waterfall');
            expect(data.charts).toMatchObject({ main: 'compare', rule: 'closest' });
            expect(data.chart).toMatchObject({ kind: 'compare', fallback: true });
        }
    });
});

function kinds(data: ReportData): ViewKind[] {
    return data.charts.views.map(viewKindOf);
}

function viewOf<K extends ReportChart['kind']>(
    data: ReportData,
    kind: K
): Extract<ReportChart, { kind: K }> {
    const view = data.charts.views.find(
        (candidate): candidate is Extract<ReportChart, { kind: K }> => candidate.kind === kind
    );
    if (!view) {
        throw new Error(`No ${kind} view among ${kinds(data).join(', ')}`);
    }
    return view;
}

describe('buildReport: chart views', () => {
    it('computes every chart that fits an activity, with the facts it fits by', async () => {
        const data = await report(intent('g-expenses', '2026', { monthly: true }));
        expect(kinds(data)).toEqual([
            'bar',
            'area',
            'stacked',
            'ranked-bar',
            'donut',
            'pie',
            'compare',
            'table',
        ]);
        expect(data.charts.facts).toEqual({
            rows: 2,
            negative: 0,
            mixed: false,
            months: 11,
            previous: true,
            net: false,
            permanent: false,
        });
        expect(data.charts).toMatchObject({ main: 'bar', rule: 'rules' });
        expect(data.charts.unfit).toBeUndefined();
        expect(viewOf(data, 'bar')).toEqual(data.chart);
    });

    it('computes the charts of a position', async () => {
        const data = await report(intent('g-assets', 'today'));
        expect(kinds(data)).toEqual(['line', 'ranked-bar', 'donut', 'pie', 'compare', 'table']);
        expect(data.charts.facts).toMatchObject({ months: 1, previous: true, permanent: true });
        expect(data.charts.main).toBe('donut');
    });

    it('has only the table when no chart fits', async () => {
        const data = await report(intent('g-card', 'last_year', { monthly: true }));
        expect(kinds(data)).toEqual(['table']);
        expect(data.charts).toMatchObject({ main: 'table', rule: 'rules' });
    });

    it('draws the preferred chart when it fits, and still offers the others', async () => {
        const data = await report(intent('g-expenses', '2026', { monthly: true, chart: 'pie' }));
        expect(data.chart.kind).toBe('pie');
        expect(data.charts).toMatchObject({ main: 'pie', rule: 'preference' });
        expect(kinds(data)).toContain('bar');
        const table = await report(intent('g-expenses', '2026', { chart: 'table' }));
        expect(table.chart).toEqual({ kind: 'none' });
        expect(table.charts).toMatchObject({ main: 'table', rule: 'preference' });
        expect(kinds(table)).toContain('donut');
    });

    it('tells why a pie cannot show a negative part, and draws the closest chart', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', ['-186.74']);
        const data = await report(intent('g-expenses', 'last_month', { chart: 'pie' }), ledger);
        expect(data.charts.unfit).toEqual({
            kind: 'pie',
            reason: { code: 'negative_part', rowId: 'g-expenses-extra-0' },
        });
        expect(data.charts.facts).toMatchObject({ rows: 3, negative: 1, mixed: false });
        expect(kinds(data)).not.toContain('pie');
        expect(kinds(data)).not.toContain('donut');
        expect(data.chart).toMatchObject({ kind: 'ranked-bar', fallback: true });
        expect(data.charts).toMatchObject({ main: 'ranked-bar', rule: 'closest' });
    });

    it('tells why a pie cannot show a net result or a mixed group', async () => {
        const net = await report(intent('net-result', 'last_month', { chart: 'pie' }));
        expect(net.charts.unfit).toEqual({ kind: 'pie', reason: { code: 'net_result' } });
        expect(net.charts).toMatchObject({ main: 'ranked-bar', rule: 'closest' });
        // A group that combines Incoming and Outgoing is a net result too.
        const mixed = await report(intent('g-net', 'last_month', { chart: 'pie' }));
        expect(mixed.charts.unfit).toEqual({ kind: 'pie', reason: { code: 'net_result' } });
    });

    it('tells why a pie cannot show parts of different types', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', ['50']);
        const snapshot = await ledgerSnapshot(ledger);
        // Positive in the root's sense, but not Outgoing.
        snapshot.accounts['g-expenses-extra-0'].type = 'ASSET';
        const data = await report(
            intent('g-expenses', 'last_month', { chart: 'pie' }),
            ledger,
            snapshot
        );
        expect(data.charts.unfit?.reason).toEqual({ code: 'mixed_parts' });
        expect(data.charts.facts).toMatchObject({ negative: 0, mixed: true });
    });

    it('tells why a pie cannot show fewer than two parts', async () => {
        const data = await report(intent('g-revenue', 'last_month', { chart: 'pie' }));
        expect(data.charts.unfit?.reason).toEqual({ code: 'few_parts' });
        // Nothing close fits, so the rules choose.
        expect(data.charts).toMatchObject({ main: 'table', rule: 'rules' });
    });

    it('tells why stacked bars or areas need two months, and stacked bars no net result', async () => {
        const month = await report(intent('g-expenses', 'last_month', { chart: 'stacked' }));
        expect(month.charts.unfit).toEqual({ kind: 'stacked', reason: { code: 'few_months' } });
        // A chart of one month by month shows nothing more than the parts.
        expect(month.charts).toMatchObject({ main: 'donut', rule: 'closest' });
        const area = await report(intent('g-expenses', 'last_month', { chart: 'area' }));
        expect(area.charts.unfit).toEqual({ kind: 'area', reason: { code: 'few_months' } });
        const net = await report(intent('net-result', '2026', { chart: 'stacked' }));
        expect(net.charts.unfit).toEqual({ kind: 'stacked', reason: { code: 'net_result' } });
        expect(net.charts).toMatchObject({ main: 'bar', rule: 'closest' });
    });

    it('tells why areas without amounts do not fit', async () => {
        const data = await report(intent('g-card', 'last_year', { chart: 'area' }));
        expect(data.charts.unfit).toEqual({ kind: 'area', reason: { code: 'no_amounts' } });
    });

    it('tells why a comparison needs a previous period', async () => {
        const compare = await report(intent('g-expenses', 'all', { chart: 'compare' }));
        expect(compare.charts.unfit).toEqual({ kind: 'compare', reason: { code: 'no_previous' } });
        expect(compare.charts.facts.previous).toBe(false);
    });

    it('draws every view from the rows and months Bkper returns, to the cent', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', [
            '300.01',
            '-40.02',
            '25.03',
            '7.04',
            '3.05',
            '1.06',
            '0.07',
        ]);
        const intents = [
            intent('g-expenses', '2026', { monthly: true }),
            intent('g-expenses', 'last_month'),
            intent('g-expenses', 'this_month'),
            intent('g-assets', 'today'),
            intent('g-assets', '2026', { monthly: true }),
            intent('g-net', 'last_12_months'),
            intent('net-result', '2026', { monthly: true }),
            intent('net-result', 'last_month'),
        ];
        const simple = withAccounts(simpleRootsLedger(), 'g-expenses', '2026-10', ['300.01']);
        const reports = [
            ...(await Promise.all(intents.map(request => report(request, ledger)))),
            await report(intent('net-result', '2026', { monthly: true }), simple),
            await report(intent('net-result', 'last_month'), simple),
        ];
        for (const data of reports) {
            const request = data.intent;
            for (const view of data.charts.views) {
                const where = `${request.root} ${request.period} ${view.kind}`;
                for (const problem of viewProblems(data, view)) {
                    expect.fail(`${where}: ${problem}`);
                }
            }
        }
    });
});

describe('buildReport: every chart a person may prefer', () => {
    it('draws bars or a line by month as preferred, for activity and positions alike', async () => {
        const line = await report(intent('g-expenses', '2026', { monthly: true, chart: 'line' }));
        expect(line.chart).toMatchObject({ kind: 'line', series: [{ id: 'g-expenses' }] });
        expect(line.charts).toMatchObject({ main: 'line', rule: 'preference' });
        expect(kinds(line)).toEqual(expect.arrayContaining(['bar', 'line']));
        const bars = await report(intent('g-assets', '2026', { monthly: true, chart: 'bar' }));
        expect(bars.chart).toMatchObject({ kind: 'bar', series: [{ id: 'g-assets' }] });
        expect(bars.charts).toMatchObject({ main: 'bar', rule: 'preference' });
        // Unpreferred, each nature offers its own chart by month only.
        const plain = await report(intent('g-expenses', '2026', { monthly: true }));
        expect(kinds(plain)).not.toContain('line');
    });

    it('draws ranked bars and a donut as preferred', async () => {
        const ranked = await report(intent('g-expenses', 'last_month', { chart: 'ranked-bar' }));
        expect(ranked.chart).toEqual({ kind: 'ranked-bar', rows: ['a-rent', 'a-food'] });
        const donut = await report(intent('g-expenses', 'last_month', { chart: 'donut' }));
        expect(donut.chart).toEqual({ kind: 'donut', rows: ['a-rent', 'a-food'] });
        expect(donut.charts.rule).toBe('preference');
    });

    it('falls from a preference that does not fit to the closest chart, with its reason', async () => {
        const few = await report(intent('g-revenue', '2026', { chart: 'ranked-bar' }));
        expect(few.charts.unfit).toEqual({ kind: 'ranked-bar', reason: { code: 'few_parts' } });
        expect(few.charts).toMatchObject({ main: 'bar', rule: 'closest' });
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', ['-186.74']);
        const donut = await report(intent('g-expenses', 'last_month', { chart: 'donut' }), ledger);
        expect(donut.charts.unfit).toEqual({
            kind: 'donut',
            reason: { code: 'negative_part', rowId: 'g-expenses-extra-0' },
        });
        expect(donut.charts).toMatchObject({ main: 'ranked-bar', rule: 'closest' });
        const today = await report(intent('g-assets', 'today', { chart: 'bar' }));
        expect(today.charts.unfit).toBeUndefined();
        expect(today.charts).toMatchObject({ main: 'bar', rule: 'preference' });
    });
});

describe('buildReport: a composition asked for', () => {
    it('draws a donut of a few positive parts', async () => {
        const data = await report(intent('g-expenses', 'last_month', { view: 'breakdown' }));
        expect(data.chart.kind).toBe('donut');
        expect(data.charts.rule).toBe('rules');
    });

    it('draws a pie of more parts than a donut holds, where the rules alone rank them', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', [
            '6',
            '5',
            '4',
            '3',
            '2',
        ]);
        const asked = await report(
            intent('g-expenses', 'last_month', { view: 'breakdown' }),
            ledger
        );
        expect(asked.charts.facts).toMatchObject({ rows: 7, negative: 0 });
        expect(asked.chart.kind).toBe('pie');
        const unasked = await report(intent('g-expenses', 'last_month'), ledger);
        expect(unasked.chart.kind).toBe('ranked-bar');
    });

    it('ranks parts that are no slices of one whole in bars, with no reason given', async () => {
        const ledger = withAccounts(fixtureLedger(), 'g-expenses', '2026-10', ['-186.74']);
        const data = await report(
            intent('g-expenses', 'last_month', { view: 'breakdown' }),
            ledger
        );
        expect(data.chart).toMatchObject({ kind: 'ranked-bar' });
        expect(data.chart.fallback).toBeUndefined();
        expect(data.charts.unfit).toBeUndefined();
    });
});

/**
 * What in a view is not drawn from the report's own rows: every part is a breakdown row with
 * its amounts, a pie or donut's parts and stacked parts are a whole of the root, and a net
 * result Report calculates is its Incoming roots minus its Outgoing roots.
 */
function viewProblems(data: ReportData, view: ReportChart): string[] {
    const problems: string[] = [];
    const rowOf = (id: string) => data.breakdown.find(row => row.id === id);
    const same = (what: string, actual: Amount | string, expected: Amount | string | undefined) => {
        if (expected === undefined || !new Amount(actual).eq(expected)) {
            problems.push(`${what}: ${new Amount(actual).toFixed()} vs ${expected}`);
        }
    };
    const calculated = (pick: (row: ReportRow) => string | undefined) =>
        data.breakdown.reduce(
            (net, row) =>
                row.type === 'INCOMING' ? net.plus(pick(row) ?? 0) : net.minus(pick(row) ?? 0),
            new Amount(0)
        );
    if (data.calculated) {
        same(
            'net',
            calculated(row => row.amount),
            data.answer.amount
        );
        data.months.forEach((month, i) =>
            same(
                `net ${month}`,
                calculated(row => row.months[i]),
                data.calculated?.months[i]
            )
        );
    }
    switch (view.kind) {
        case 'bar':
        case 'line':
        case 'area':
            for (const series of view.series) {
                const expected =
                    series.id === 'net-result'
                        ? data.calculated?.months
                        : series.id === data.root.id
                          ? undefined
                          : rowOf(series.id)?.months;
                if (series.id !== data.root.id) {
                    data.months.forEach((month, i) =>
                        same(`${series.id} ${month}`, series.amounts[i], expected?.[i])
                    );
                }
            }
            break;
        case 'stacked':
            if (view.series.length > 6) {
                problems.push('more than six parts');
            }
            for (const series of view.series) {
                data.months.forEach((month, i) =>
                    same(`${series.id} ${month}`, series.amounts[i], rowOf(series.id)?.months[i])
                );
            }
            break;
        case 'ranked-bar':
        case 'donut':
        case 'pie':
        case 'compare': {
            const rows = view.rows.map(id => rowOf(id));
            if (rows.some(row => row === undefined)) {
                problems.push('draws a row the breakdown lacks');
            }
            if (view.kind === 'donut' || view.kind === 'pie') {
                same('whole', total(rows.map(row => row?.amount)), data.answer.amount);
            }
            break;
        }
        case 'none':
            break;
    }
    return problems;
}
