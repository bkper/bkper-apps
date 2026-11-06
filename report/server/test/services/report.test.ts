import { Amount, BalancesReport, Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    readLiveBalances,
    type LiveBalances,
    type LiveQuery,
} from '../../src/services/live-balances';
import {
    ReportError,
    buildReport,
    type ReportData,
    type ReportRow,
} from '../../src/services/report';
import type { ReportIntent } from '../../src/services/report-intent';
import type { Snapshot } from '../../src/services/snapshot';
import { DATA_AT, bookPayload, fixtureSnapshot } from '../fixtures/snapshot-book';

const LIVE_AT = new Date('2026-11-05T15:00:30Z');

function intent(root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent {
    return { root, period, monthly: false, ...extra };
}

async function report(
    request: ReportIntent,
    snapshot?: Snapshot,
    live?: LiveBalances
): Promise<ReportData> {
    const step = buildReport(request, snapshot ?? (await fixtureSnapshot()), live);
    if (!('report' in step)) {
        throw new Error(`Needs a live query: ${step.liveQuery.query}`);
    }
    return step.report;
}

/** Name, amount, previous and change of each row, children indented. */
function rows(breakdown: ReportRow[], depth = 0): string[] {
    return breakdown.flatMap(row => [
        `${'  '.repeat(depth)}${row.name ?? row.kind} ${row.amount} (prev ${row.previous ?? '-'}` +
            `, change ${row.change ?? '-'}, share ${row.share ?? '-'})`,
        ...rows(row.children, depth + 1),
    ]);
}

function day(date: string, period: string): bkper.Balance {
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    return { year, month, day: dayOfMonth, periodBalance: period, cumulativeBalance: '0' };
}

/** A `by:d` result for Expenses, raw (credit minus debit) like the Bkper API. */
const expensesByDay: bkper.Balances = {
    periodicity: 'DAILY',
    groupBalances: [
        {
            name: 'Expenses',
            credit: false,
            permanent: false,
            balances: [
                day('2026-10-02', '-30'),
                day('2026-11-04', '-12.5'),
                day('2026-11-05', '-7.25'),
            ],
            accountBalances: [
                {
                    name: 'Food',
                    credit: false,
                    permanent: false,
                    balances: [day('2026-10-02', '-30'), day('2026-11-05', '-7.25')],
                },
                {
                    name: 'Rent',
                    credit: false,
                    permanent: false,
                    balances: [day('2026-11-04', '-12.5')],
                },
            ],
        },
    ],
};

function live(query: LiveQuery, snapshot: Snapshot, payload = expensesByDay): LiveBalances {
    return readLiveBalances(
        query,
        new BalancesReport(new Book(bookPayload), payload),
        snapshot,
        LIVE_AT
    );
}

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
            id: 'last_month',
            after: '2026-10-01',
            before: '2026-11-01',
        });
        expect(data.previous).toEqual({ after: '2026-09-01', before: '2026-10-01' });
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
        expect(data.query).toBe("group:'Expenses' after:2026-10-01 before:2026-11-01");
        expect(data.url).toBe(
            `https://bkper.app/books/book-1/transactions?query=${encodeURIComponent(data.query)}`
        );
        expect(data.dataAt).toBe(DATA_AT.toISOString());
        expect(data.months).toEqual(['2026-10']);
        expect(data.breakdown.map(row => row.months)).toEqual([['1000'], ['200.5']]);
    });

    it('compares a current period with the same days of the previous one', async () => {
        const data = await report(intent('g-expenses', 'this_month'));
        expect(data.period).toEqual({
            id: 'this_month',
            after: '2026-11-01',
            before: '2026-11-06',
        });
        expect(data.previous).toEqual({ after: '2026-10-01', before: '2026-10-06' });
        expect(data.answer).toEqual({ amount: '1050.25', previous: '1000', change: '0.0503' });
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 1000, change 0, share 0.9522)',
            'Food 50.25 (prev 0, change -, share 0.0478)',
        ]);
    });

    it('reads a calendar period that has not ended to date, like its current period', async () => {
        const data = await report(intent('g-expenses', '2026', { monthly: true }));
        expect(data.intent.period).toBe('2026');
        expect(data.period).toEqual({ id: 'this_year', after: '2026-01-01', before: '2026-11-06' });
        expect(data.previous).toEqual({ after: '2025-01-01', before: '2025-11-06' });
        expect(data.answer).toEqual({ amount: '3250.75', previous: '1000', change: '2.2508' });
        expect(data.query).toBe("group:'Expenses' after:2026-01-01 before:2026-11-06");
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
        expect(data.period).toEqual({ id: 'all', before: '2026-11-06' });
        expect(data.previous).toBeUndefined();
        expect(data.answer).toEqual({ amount: '4260.75' });
        expect(data.query).toBe("group:'Expenses' before:2026-11-06");
        expect(data.months[0]).toBe('2024-03');
        expect(data.months.at(-1)).toBe('2026-11');
        expect(rows(data.breakdown)).toEqual([
            'Rent 4000 (prev -, change -, share 0.9388)',
            'Food 250.75 (prev -, change -, share 0.0589)',
            'Old Supplier 10 (prev -, change -, share 0.0023)',
        ]);
    });

    it('rejects a period that has not started', async () => {
        const snapshot = await fixtureSnapshot();
        expect(() => buildReport(intent('g-expenses', '2027'), snapshot)).toThrow(ReportError);
        expect(() => buildReport(intent('g-expenses', '2026-12'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'future_period' })
        );
    });

    it('rejects a root that is not a root group of the Book', async () => {
        const snapshot = await fixtureSnapshot();
        for (const root of ['g-banks', 'missing']) {
            expect(() => buildReport(intent(root, 'last_month'), snapshot)).toThrow(
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
        expect(data.period).toEqual({ id: 'today', after: '2026-11-05', before: '2026-11-06' });
        expect(data.previous).toEqual({ before: '2026-11-01' });
        expect(data.answer).toEqual({ amount: '7849.25', previous: '3899.5', change: '1.0129' });
        expect(rows(data.breakdown)).toEqual([
            'Banks 7749.25 (prev 3799.5, change 1.0395, share 0.9873)',
            '  Bank A 7749.25 (prev 3799.5, change 1.0395, share 1)',
            'Cash 100 (prev 100, change 0, share 0.0127)',
        ]);
        expect(data.breakdown[0]).toMatchObject({ id: 'g-banks', kind: 'group', type: 'ASSET' });
        expect(data.query).toBe("group:'Assets' before:2026-11-06");
        expect(data.chart).toEqual({ kind: 'donut', rows: ['g-banks', 'a-cash'] });
    });

    it('shows positions at the end of each month on a line', async () => {
        const data = await report(intent('g-assets', '2026-Q4', { monthly: true }));
        expect(data.period).toEqual({
            id: 'this_quarter',
            after: '2026-10-01',
            before: '2026-11-06',
        });
        expect(data.previous).toEqual({ before: '2026-10-01' });
        expect(data.answer).toEqual({ amount: '7849.25', previous: '100', change: '77.4925' });
        expect(data.months).toEqual(['2026-10', '2026-11']);
        expect(data.chart).toMatchObject({
            kind: 'line',
            series: [{ id: 'g-assets', amounts: ['3899.5', '7849.25'] }],
        });
    });
});

describe('buildReport: mixed groups and net result', () => {
    it('counts children of the other credit nature with the opposite sign, so rows add up', async () => {
        const data = await report(intent('g-net', 'last_month'));
        expect(data.nature).toBe('activity');
        expect(data.root).toMatchObject({ type: 'MIXED', color: 'grey' });
        expect(data.answer.amount).toBe('3799.5');
        // Shares of a mixed total would mislead, so they are left out.
        expect(rows(data.breakdown)).toEqual([
            'Salary 5000 (prev 0, change -, share -)',
            'Rent -1000 (prev 0, change -, share -)',
            'Food -200.5 (prev 0, change -, share -)',
        ]);
        expect(data.breakdown.map(row => row.color)).toEqual(['green', 'red', 'red']);
        expect(data.chart).toEqual({ kind: 'ranked-bar', rows: ['a-salary', 'a-rent', 'a-food'] });
    });

    it('nets Incoming against Outgoing over the unique accounts of the activity roots', async () => {
        const data = await report(intent('net-result', 'all'));
        expect(data.root).toEqual({ id: 'net-result', type: 'MIXED', color: 'grey' });
        // Rent and Food are under two roots but count once; Old Supplier is under one.
        expect(data.net).toMatchObject({
            incoming: { amount: '10000' },
            outgoing: { amount: '4260.75' },
        });
        expect(data.answer).toEqual({ amount: '5739.25' });
        // Outgoing shows positive, like the answer; the net result is Incoming minus Outgoing.
        expect(rows(data.breakdown)).toEqual([
            'incoming 10000 (prev -, change -, share -)',
            '  Salary 10000 (prev -, change -, share 1)',
            'outgoing 4260.75 (prev -, change -, share -)',
            '  Rent 4000 (prev -, change -, share 0.9388)',
            '  Food 250.75 (prev -, change -, share 0.0589)',
            '  Old Supplier 10 (prev -, change -, share 0.0023)',
        ]);
        expect(data.breakdown.map(row => [row.id, row.type, row.color])).toEqual([
            ['incoming', 'INCOMING', 'green'],
            ['outgoing', 'OUTGOING', 'red'],
        ]);
        expect(data.query).toBe(
            "(group:'Expenses' OR group:'Revenue' OR group:'Net income') before:2026-11-06"
        );
    });

    it('compares the net result with the previous period and shows it by month', async () => {
        const data = await report(intent('net-result', 'this_month', { monthly: true }));
        expect(data.net).toEqual({
            incoming: { amount: '5000', previous: '5000', change: '0' },
            outgoing: { amount: '1050.25', previous: '1000', change: '0.0503' },
            months: ['3949.75'],
        });
        expect(data.answer).toEqual({ amount: '3949.75', previous: '4000', change: '-0.0126' });
        // The rows carry the same amounts and changes as the answer's sides.
        expect(rows(data.breakdown).filter(row => !row.startsWith(' '))).toEqual([
            'incoming 5000 (prev 5000, change 0, share -)',
            'outgoing 1050.25 (prev 1000, change 0.0503, share -)',
        ]);
        expect(data.chart).toEqual({
            kind: 'bar',
            series: [
                { id: 'incoming', type: 'INCOMING', color: 'green', amounts: ['5000'] },
                { id: 'outgoing', type: 'OUTGOING', color: 'red', amounts: ['1050.25'] },
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

    it('nets Incoming against Outgoing in every month', async () => {
        const data = await report(intent('net-result', 'last_12_months', { monthly: true }));
        const [incoming, outgoing] = data.breakdown;
        expect(data.net?.months).toEqual(
            data.months.map((_, i) =>
                new Amount(incoming.months[i]).minus(outgoing.months[i]).toFixed()
            )
        );
        expect(data.net?.months.slice(-2)).toEqual(['3799.5', '3949.75']);
    });

    it('leaves a side without amount out of the chart of a net result', async () => {
        const data = await report(intent('net-result', '2026-09', { monthly: true }));
        expect(rows(data.breakdown)).toEqual([
            'outgoing 0 (prev 1000, change -1, share -)',
            '  Rent 0 (prev 1000, change -1, share -)',
        ]);
        expect(data.chart.kind === 'bar' && data.chart.series.map(series => series.id)).toEqual([
            'net-result',
        ]);
    });

    it('rejects a net result in a Book without activity roots', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.roots = snapshot.roots.filter(id => snapshot.groups[id].permanent);
        expect(() => buildReport(intent('net-result', 'last_month'), snapshot)).toThrow(
            expect.objectContaining({ reason: 'no_activity_roots' })
        );
    });
});

describe('buildReport: remainder', () => {
    it('adds the amount Bkper left out of the children, so the breakdown adds up', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.groups['g-expenses'].accounts = ['a-rent', 'a-old'];
        const data = await report(intent('g-expenses', 'this_month'), snapshot);
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 1000, change 0, share 0.9522)',
            'other 50.25 (prev 0, change -, share 0.0478)',
        ]);
        expect(data.breakdown[1]).toMatchObject({
            id: 'g-expenses:other',
            type: 'OUTGOING',
            months: ['50.25'],
        });
        expect(data.breakdown[1].name).toBeUndefined();
    });
});

/** Adds an Expenses account that moved only in September 2026, and the move to its group. */
function withSeptemberOnly(snapshot: Snapshot): Snapshot {
    const id = 'a-september';
    snapshot.accounts[id] = {
        ...snapshot.accounts['a-food'],
        id,
        name: 'September Only',
        months: [{ month: '2026-09', period: '5', cumulative: '5' }],
        windows: [],
    };
    const expenses = snapshot.groups['g-expenses'];
    expenses.accounts.push(id);
    expenses.months = [...expenses.months, { month: '2026-09', period: '5', cumulative: '0' }].sort(
        (a, b) => a.month.localeCompare(b.month)
    );
    return snapshot;
}

describe('buildReport: rows without amount', () => {
    it('keeps them in the table, last, and leaves them out of breakdown charts', async () => {
        const snapshot = withSeptemberOnly(await fixtureSnapshot());
        snapshot.groups['g-expenses'].accounts = ['a-rent', 'a-september'];
        const data = await report(intent('g-expenses', 'last_month'), snapshot);
        expect(rows(data.breakdown)).toEqual([
            'Rent 1000 (prev 0, change -, share 0.833)',
            'other 200.5 (prev 0, change -, share 0.167)',
            'September Only 0 (prev 5, change -1, share 0)',
        ]);
        expect(data.chart).toEqual({ kind: 'donut', rows: ['a-rent', 'g-expenses:other'] });
    });

    it('needs two rows with amounts for a breakdown chart', async () => {
        const snapshot = withSeptemberOnly(await fixtureSnapshot());
        const expenses = snapshot.groups['g-expenses'];
        expenses.accounts = ['a-rent', 'a-september'];
        expenses.months = expenses.months.map(month =>
            month.month === '2026-10' ? { ...month, period: '1000' } : month
        );
        const data = await report(
            intent('g-expenses', 'last_month', { view: 'breakdown' }),
            snapshot
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

    it('needs two rows for a breakdown chart', async () => {
        const data = await report(intent('g-revenue', 'last_month'));
        expect(data.breakdown).toHaveLength(1);
        expect(data.chart).toEqual({ kind: 'none' });
    });

    it('ranks more than six rows in bars', async () => {
        const snapshot = await fixtureSnapshot();
        const expenses = snapshot.groups['g-expenses'];
        for (let i = 0; i < 6; i++) {
            const id = `a-extra-${i}`;
            const months = [{ month: '2026-10', period: '1', cumulative: '1' }];
            snapshot.accounts[id] = {
                ...snapshot.accounts['a-food'],
                id,
                name: `Extra ${i}`,
                months,
            };
            expenses.accounts.push(id);
        }
        expenses.months = expenses.months.map(month =>
            month.month === '2026-10' ? { ...month, period: '1206.5' } : month
        );
        const data = await report(intent('g-expenses', 'last_month'), snapshot);
        expect(data.breakdown).toHaveLength(8);
        expect(data.breakdown.every(row => row.kind === 'account')).toBe(true);
        expect(data.chart.kind).toBe('ranked-bar');
    });
});

describe('buildReport: live balances', () => {
    it('asks for one live query by day when the snapshot cannot answer the period', async () => {
        const snapshot = await fixtureSnapshot();
        const step = buildReport(intent('g-expenses', 'today'), snapshot);
        expect(step).toEqual({
            liveQuery: {
                query: "group:'Expenses' after:2026-11-04 before:2026-11-06 by:d",
                after: '2026-11-04',
                before: '2026-11-06',
                hashtags: [],
            },
        });
        if (!('liveQuery' in step)) {
            return;
        }
        const data = await report(
            intent('g-expenses', 'today'),
            snapshot,
            live(step.liveQuery, snapshot)
        );
        expect(data.previous).toEqual({ after: '2026-11-04', before: '2026-11-05' });
        expect(data.answer).toEqual({ amount: '7.25', previous: '12.5', change: '-0.42' });
        expect(rows(data.breakdown)).toEqual([
            'Food 7.25 (prev 0, change -, share 1)',
            'Rent 0 (prev 12.5, change -1, share 0)',
        ]);
        expect(data.query).toBe("group:'Expenses' after:2026-11-05 before:2026-11-06");
    });

    it('reads a net result today live from every activity root', async () => {
        const snapshot = await fixtureSnapshot();
        const step = buildReport(intent('net-result', 'today'), snapshot);
        expect('liveQuery' in step && step.liveQuery.query).toBe(
            "(group:'Expenses' OR group:'Revenue' OR group:'Net income') after:2026-11-04 before:2026-11-06 by:d"
        );
    });

    it('reads hashtag reports only from the hashtag query, never from the snapshot', async () => {
        const snapshot = await fixtureSnapshot();
        const request = intent('g-expenses', 'last_month', { hashtags: ['trip'] });
        const step = buildReport(request, snapshot);
        expect(step).toEqual({
            liveQuery: {
                query:
                    "(group:'Assets' OR group:'Card' OR group:'Expenses' OR group:'Revenue' OR group:'Net income') " +
                    '#trip before:2026-11-06 by:d',
                before: '2026-11-06',
                hashtags: ['trip'],
            },
        });
        if (!('liveQuery' in step)) {
            return;
        }
        const data = await report(request, snapshot, live(step.liveQuery, snapshot));
        expect(data.answer).toEqual({ amount: '30', previous: '0' });
        expect(rows(data.breakdown)).toEqual(['Food 30 (prev 0, change -, share 1)']);
        expect(data.query).toBe("group:'Expenses' #trip after:2026-10-01 before:2026-11-01");
        expect(data.dataAt).toBe(LIVE_AT.toISOString());
    });

    it('answers any period with hashtags from the full history by day', async () => {
        const snapshot = await fixtureSnapshot();
        const request = intent('g-expenses', 'this_month', { hashtags: ['trip'] });
        const step = buildReport(request, snapshot);
        if (!('liveQuery' in step)) {
            throw new Error('Expected a live query');
        }
        const data = await report(request, snapshot, live(step.liveQuery, snapshot));
        expect(data.answer).toEqual({ amount: '19.75', previous: '30', change: '-0.3417' });
    });

    it('rejects live balances read for other hashtags', async () => {
        const snapshot = await fixtureSnapshot();
        const other = live({ query: 'q', before: '2026-11-06', hashtags: ['other'] }, snapshot);
        expect(() =>
            buildReport(intent('g-expenses', 'last_month', { hashtags: ['trip'] }), snapshot, other)
        ).toThrow('The live balances were read for other hashtags');
    });
});
