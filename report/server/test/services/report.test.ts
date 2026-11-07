import { Amount } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import type { QueryBalances } from '../../src/services/balances';
import {
    ReportError,
    buildReport,
    planQueries,
    planReport,
    viewKindOf,
    type ReportChart,
    type ReportData,
    type ReportRow,
    type ViewKind,
} from '../../src/services/report';
import type { ReportIntent } from '../../src/services/report-intent';
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

function intent(root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent {
    return { root, period, monthly: false, ...extra };
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

    it('reads a root for the period and for the previous one, by month', async () => {
        expect(await queries(intent('g-expenses', 'last_month'))).toEqual([
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
        ]);
        // A comparison ending in the middle of a month is an ordinary period query.
        expect(await queries(intent('g-expenses', 'this_month'))).toEqual([
            "group:'Expenses' after:2026-11-01 before:2026-11-06 by:m",
            "group:'Expenses' after:2026-10-01 before:2026-10-06 by:m",
        ]);
        expect(await queries(intent('g-expenses', 'today'))).toEqual([
            "group:'Expenses' after:2026-11-05 before:2026-11-06 by:m",
            "group:'Expenses' after:2026-11-04 before:2026-11-05 by:m",
        ]);
        expect(await queries(intent('g-expenses', 'all'))).toEqual([
            "group:'Expenses' before:2026-11-06 by:m",
        ]);
    });

    it('reads a position at the end of the period and of the previous one', async () => {
        expect(await queries(intent('g-assets', 'today'))).toEqual([
            "group:'Assets' after:2026-11-05 before:2026-11-06 by:m",
            "group:'Assets' before:2026-11-01 by:m",
        ]);
        expect(await queries(intent('g-assets', '2025'))).toEqual([
            "group:'Assets' after:2025-01-01 before:2026-01-01 by:m",
            "group:'Assets' before:2025-01-01 by:m",
        ]);
    });

    it('reads the group that combines Incoming and Outgoing for a net result', async () => {
        expect(await queries(intent('net-result', 'last_month'))).toEqual([
            "group:'Net income' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Net income' after:2026-09-01 before:2026-10-01 by:m",
        ]);
    });

    it('reads each simple activity root of a net result with a query of its own', async () => {
        expect(await queries(intent('net-result', 'last_month'), simpleRootsLedger())).toEqual([
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
            "group:'Revenue' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Revenue' after:2026-09-01 before:2026-10-01 by:m",
        ]);
    });

    it('filters the queries by the hashtags', async () => {
        expect(
            await queries(intent('g-expenses', 'last_month', { hashtags: ['trip', 'q4'] }))
        ).toEqual([
            "group:'Expenses' #trip #q4 after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' #trip #q4 after:2026-09-01 before:2026-10-01 by:m",
        ]);
    });

    it('reads a position with hashtags from the start, as Bkper starts it at after: unfiltered', async () => {
        expect(await queries(intent('g-assets', '2026-Q4', { hashtags: ['trip'] }))).toEqual([
            "group:'Assets' #trip before:2026-11-06 by:m",
            "group:'Assets' #trip before:2026-10-01 by:m",
        ]);
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
            if (balances.query.includes('after:2026-01-01')) {
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
            balances.groups.Assets.cumulative = balances.query.includes('after:')
                ? '123.45'
                : '67.89';
        });
        expect(data.answer).toMatchObject({ amount: '123.45', previous: '67.89' });
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
        expect(data.query).toBe("group:'Net income' before:2026-11-06");
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
        expect(planReport(intent('net-result', 'last_month'), snapshot).roots).toEqual(['g-net']);
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
        expect(data.query).toBe("(group:'Expenses' OR group:'Revenue') before:2026-11-06");
    });

    it('compares the net result with the previous period and shows it by month', async () => {
        const data = await report(
            intent('net-result', 'this_month', { monthly: true }),
            simpleRootsLedger()
        );
        expect(data.answer).toEqual({ amount: '3949.75', previous: '4000', change: '-0.0126' });
        expect(data.calculated).toEqual({ months: ['3949.75'] });
        expect(rows(data.breakdown).filter(row => !row.startsWith(' '))).toEqual([
            'Revenue 5000 (prev 5000, change 0, share -)',
            'Expenses 1050.25 (prev 1000, change 0.0503, share -)',
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

    it('reads a net result today from each root', async () => {
        const data = await report(intent('net-result', 'today'), simpleRootsLedger());
        expect(rows(data.breakdown).filter(row => !row.startsWith(' '))).toEqual([
            'Revenue 5000 (prev 0, change -, share -)',
            'Expenses 0 (prev 50.25, change -1, share -)',
        ]);
        expect(data.answer).toMatchObject({ amount: '5000', previous: '-50.25' });
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
    it('reads today like any other period, against yesterday', async () => {
        const data = await report(intent('g-expenses', 'today'));
        expect(data.period).toEqual({ id: 'today', after: '2026-11-05', before: '2026-11-06' });
        expect(data.previous).toEqual({ after: '2026-11-04', before: '2026-11-05' });
        expect(data.answer).toEqual({ amount: '0', previous: '50.25', change: '-1' });
        expect(rows(data.breakdown)).toEqual(['Food 0 (prev 50.25, change -1, share -)']);
        expect(data.query).toBe("group:'Expenses' after:2026-11-05 before:2026-11-06");
    });

    it('reads hashtag reports from queries filtered by the hashtags', async () => {
        const data = await report(intent('g-expenses', 'last_month', { hashtags: ['trip'] }));
        expect(data.answer).toEqual({ amount: '200.5', previous: '0' });
        expect(rows(data.breakdown)).toEqual(['Food 200.5 (prev 0, change -, share 1)']);
        expect(data.query).toBe("group:'Expenses' #trip after:2026-10-01 before:2026-11-01");
        const month = await report(intent('g-expenses', 'this_month', { hashtags: ['trip'] }));
        expect(month.answer).toEqual({ amount: '1000', previous: '0' });
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
