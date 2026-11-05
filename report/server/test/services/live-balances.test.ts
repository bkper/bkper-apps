import { BalancesReport, Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    hashtagQuery,
    livePeriodAmount,
    livePositionAmount,
    rangeQuery,
    readLiveBalances,
    type LiveQuery,
} from '../../src/services/live-balances';
import type { Snapshot } from '../../src/services/snapshot';
import { bookPayload, fixtureSnapshot } from '../fixtures/snapshot-book';

const DATA_AT = new Date('2026-11-05T15:00:10Z');

function day(date: string, period: string): bkper.Balance {
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    return {
        year,
        month,
        day: dayOfMonth,
        fuzzyDate: year * 10000 + month * 100 + dayOfMonth,
        periodBalance: period,
        cumulativeBalance: '0',
    };
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

async function read(query: LiveQuery, payload: bkper.Balances) {
    const book = new Book(bookPayload);
    return readLiveBalances(
        query,
        new BalancesReport(book, payload),
        await fixtureSnapshot(),
        DATA_AT
    );
}

describe('hashtagQuery', () => {
    it('reads every root with the hashtags by day, over the full history up to today', async () => {
        const query = hashtagQuery(await fixtureSnapshot(), ['trip', 'q4']);
        expect(query).toEqual({
            query:
                "(group:'Assets' OR group:'Card' OR group:'Expenses' OR group:'Revenue' OR group:'Net income') " +
                '#trip #q4 before:2026-11-06 by:d',
            before: '2026-11-06',
            hashtags: ['trip', 'q4'],
        });
    });
});

describe('rangeQuery', () => {
    it('reads the given roots by day within a range', async () => {
        const snapshot = await fixtureSnapshot();
        expect(
            rangeQuery(snapshot, ['g-expenses'], { after: '2026-11-04', before: '2026-11-06' })
        ).toEqual({
            query: "group:'Expenses' after:2026-11-04 before:2026-11-06 by:d",
            after: '2026-11-04',
            before: '2026-11-06',
            hashtags: [],
        });
        expect(
            rangeQuery(snapshot, ['g-expenses', 'g-revenue'], {
                after: '2026-11-04',
                before: '2026-11-06',
            }).query
        ).toBe("(group:'Expenses' OR group:'Revenue') after:2026-11-04 before:2026-11-06 by:d");
    });
});

describe('readLiveBalances', () => {
    it('keeps daily amounts by group and account id, with the sign Bkper shows', async () => {
        const live = await read(
            { query: 'q', before: '2026-11-06', hashtags: ['trip'] },
            expensesByDay
        );
        expect(live.dataAt).toBe('2026-11-05T15:00:10.000Z');
        expect(live.groups['g-expenses']).toEqual([
            { date: '2026-10-02', period: '30' },
            { date: '2026-11-04', period: '12.5' },
            { date: '2026-11-05', period: '7.25' },
        ]);
        expect(live.accounts['a-food']).toEqual([
            { date: '2026-10-02', period: '30' },
            { date: '2026-11-05', period: '7.25' },
        ]);
        expect(live.accounts['a-salary']).toBeUndefined();
    });

    it('rejects balances of a group the snapshot does not know', async () => {
        const payload: bkper.Balances = { groupBalances: [{ name: 'Unknown', balances: [] }] };
        await expect(
            read({ query: 'q', before: '2026-11-06', hashtags: [] }, payload)
        ).rejects.toThrow('Group not in the snapshot: Unknown');
    });
});

describe('livePeriodAmount and livePositionAmount', () => {
    let snapshot: Snapshot;

    it('sums the days within a range the query covers', async () => {
        snapshot = await fixtureSnapshot();
        const live = await read(
            { query: 'q', after: '2026-11-04', before: '2026-11-06', hashtags: [] },
            expensesByDay
        );
        const expenses = snapshot.groups['g-expenses'];
        const amount = (after: string | undefined, before: string) =>
            livePeriodAmount(live, expenses, { after, before })?.toString();
        expect(amount('2026-11-05', '2026-11-06')).toBe('7.25');
        expect(amount('2026-11-04', '2026-11-05')).toBe('12.5');
        expect(amount('2026-11-03', '2026-11-06')).toBeUndefined();
        expect(amount(undefined, '2026-11-06')).toBeUndefined();
        expect(amount('2026-11-04', '2026-11-07')).toBeUndefined();
        // A node without days had no movement.
        expect(
            livePeriodAmount(live, snapshot.accounts['a-salary'], {
                after: '2026-11-04',
                before: '2026-11-06',
            })?.toString()
        ).toBe('0');
        // Positions need the full history.
        expect(livePositionAmount(live, expenses, '2026-11-06')).toBeUndefined();
    });

    it('answers any range and position up to today from the full history', async () => {
        snapshot = await fixtureSnapshot();
        const live = await read(
            { query: 'q', before: '2026-11-06', hashtags: ['trip'] },
            expensesByDay
        );
        const expenses = snapshot.groups['g-expenses'];
        expect(livePeriodAmount(live, expenses, { before: '2026-11-06' })?.toString()).toBe(
            '49.75'
        );
        expect(
            livePeriodAmount(live, expenses, {
                after: '2026-11-01',
                before: '2026-11-05',
            })?.toString()
        ).toBe('12.5');
        expect(livePositionAmount(live, expenses, '2026-11-01')?.toString()).toBe('30');
        expect(livePositionAmount(live, expenses, '2026-11-07')).toBeUndefined();
    });
});
