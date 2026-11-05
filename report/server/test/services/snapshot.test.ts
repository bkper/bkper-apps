import { BalancesReport, Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    buildSnapshot,
    comparisonWindows,
    periodAmount,
    positionAmount,
    quote,
    snapshotQueries,
    type Snapshot,
} from '../../src/services/snapshot';
import { TODAY, balancesPayloads, bookPayload } from '../fixtures/snapshot-book';

const DATA_AT = new Date('2026-11-05T15:00:00Z');

async function build(payload: bkper.Book = bookPayload, balances = balancesPayloads) {
    const book = new Book(payload);
    const groups = await book.getGroups();
    const accounts = await book.getAccounts();
    const roots = groups.filter(group => !group.hasParent());
    const results = snapshotQueries(
        roots.map(root => ({ name: root.getName() ?? '', permanent: root.isPermanent() ?? false })),
        TODAY
    ).map(query => {
        const payload = balances[query.query];
        if (!payload) {
            throw new Error(`No recorded balances for ${query.query}`);
        }
        return { query, report: new BalancesReport(book, payload) };
    });
    return buildSnapshot({ book, groups, accounts, results, today: TODAY, dataAt: DATA_AT });
}

describe('comparisonWindows', () => {
    it('completes the comparisons of the current periods with partial months', () => {
        expect(comparisonWindows('2026-11-05')).toEqual([
            { after: '2026-10-01', before: '2026-10-06' },
            { after: '2026-08-01', before: '2026-08-06' },
            { after: '2025-11-01', before: '2025-11-06' },
        ]);
    });

    it('needs no window when the comparison ends with a whole month', () => {
        expect(comparisonWindows('2026-03-31')).toEqual([]);
    });
});

describe('snapshotQueries', () => {
    it('reads every root by month up to today, and activity roots within each window', () => {
        const queries = snapshotQueries(
            [
                { name: 'Assets', permanent: true },
                { name: 'Expenses', permanent: false },
            ],
            TODAY
        );
        expect(queries.map(q => q.query)).toEqual([
            "group:'Assets' before:2026-11-06 by:m",
            "group:'Expenses' before:2026-11-06 by:m",
            "group:'Expenses' after:2026-10-01 before:2026-10-06",
            "group:'Expenses' after:2026-08-01 before:2026-08-06",
            "group:'Expenses' after:2025-11-01 before:2025-11-06",
        ]);
        expect(queries[2].window).toEqual({ after: '2026-10-01', before: '2026-10-06' });
        expect(queries[1].window).toBeUndefined();
    });

    it('quotes names with a single quote in double quotes', () => {
        expect(quote('Sales & Marketing')).toBe("'Sales & Marketing'");
        expect(quote("Owner's Equity")).toBe('"Owner\'s Equity"');
    });
});

describe('buildSnapshot', () => {
    it('keeps the Book, the time of the data and the root groups in Book order', async () => {
        const snapshot = await build();
        expect(snapshot.book).toEqual({
            id: 'book-1',
            name: 'Test Ledger',
            timeZone: 'America/Sao_Paulo',
            fractionDigits: 2,
            permission: 'VIEWER',
        });
        expect(snapshot.today).toBe(TODAY);
        expect(snapshot.dataAt).toBe('2026-11-05T15:00:00.000Z');
        expect(snapshot.roots).toEqual(['g-assets', 'g-card', 'g-expenses', 'g-revenue', 'g-net']);
    });

    it('builds the tree of subgroups and accounts under each root', async () => {
        const { groups, accounts } = await build();
        expect(groups['g-assets']).toMatchObject({
            name: 'Assets',
            type: 'ASSET',
            permanent: true,
            credit: false,
            groups: ['g-banks'],
            accounts: ['a-cash'],
        });
        expect(groups['g-assets'].parent).toBeUndefined();
        expect(groups['g-banks']).toMatchObject({
            parent: 'g-assets',
            groups: [],
            accounts: ['a-bank-a', 'a-bank-b'],
        });
        expect(groups['g-net']).toMatchObject({
            type: 'MIXED',
            permanent: false,
            credit: true,
            accounts: ['a-rent', 'a-food', 'a-salary'],
        });
        expect(accounts['a-old']).toMatchObject({ type: 'OUTGOING', archived: true });
        expect(accounts['a-card']).toMatchObject({ type: 'LIABILITY', credit: true, months: [] });
        expect(Object.keys(accounts)).toHaveLength(8);
    });

    it('uses the sign Bkper shows: debit-nature balances are negated', async () => {
        const { groups, accounts } = await build();
        expect(groups['g-expenses'].months.at(-2)).toEqual({
            month: '2026-10',
            period: '1200.5',
            cumulative: '3210.5',
        });
        expect(accounts['a-salary'].months[0]).toEqual({
            month: '2026-10',
            period: '5000',
            cumulative: '5000',
        });
        expect(groups['g-assets'].months.at(-1)).toEqual({
            month: '2026-11',
            period: '3949.75',
            cumulative: '7849.25',
        });
        // Mixed Incoming and Outgoing follows the group's credit nature: income minus expenses.
        expect(groups['g-net'].months.at(-1)?.period).toBe('3949.75');
        expect(accounts['a-rent'].months.at(-1)?.period).toBe('1000');
    });

    it('keeps an account under several roots once, with windows only for activity roots', async () => {
        const { accounts, groups } = await build();
        expect(accounts['a-rent'].windows).toEqual([
            { after: '2026-10-01', before: '2026-10-06', period: '1000' },
            { after: '2026-08-01', before: '2026-08-06', period: '0' },
            { after: '2025-11-01', before: '2025-11-06', period: '1000' },
        ]);
        expect(groups['g-expenses'].windows.map(w => w.period)).toEqual(['1000', '0', '1000']);
        expect(groups['g-net'].windows.map(w => w.period)).toEqual(['4000', '0', '-1000']);
        expect(groups['g-assets'].windows).toEqual([]);
        expect(accounts['a-cash'].windows).toEqual([]);
    });

    it('reads an account left out of a window as no movement in it', async () => {
        const { accounts } = await build();
        expect(accounts['a-old'].windows.map(w => [w.after, w.period])).toEqual([
            ['2026-10-01', '0'],
            ['2026-08-01', '0'],
            ['2025-11-01', '0'],
        ]);
        expect(accounts['a-food'].windows.map(w => w.period)).toEqual(['0', '0', '0']);
    });

    it('spans the data range over months with movements in any root', async () => {
        expect((await build()).dataRange).toEqual({ firstMonth: '2024-03', lastMonth: '2026-11' });
    });

    it('ignores the empty bucket of the current month in the data range', async () => {
        const old = (name: string) => [
            {
                name,
                credit: false,
                permanent: false,
                balances: [bucket(2019, 4, '-50', '0', '50'), bucket(2026, 11, '0', '0', '0')],
                accountBalances: [],
            },
        ];
        const payloads: Record<string, bkper.Balances> = {};
        const groups = [
            { id: 'g-x', name: 'Expenses', type: 'OUTGOING' as const, permanent: false },
        ];
        for (const query of snapshotQueries([{ name: 'Expenses', permanent: false }], TODAY)) {
            payloads[query.query] = { groupBalances: old('Expenses') };
        }
        const snapshot = await build({ ...bookPayload, groups, accounts: [] }, payloads);
        expect(snapshot.dataRange).toEqual({ firstMonth: '2019-04', lastMonth: '2019-04' });
    });

    it('has no data range for a Book without movements', async () => {
        const groups = [{ id: 'g-x', name: 'Assets', type: 'ASSET' as const, permanent: true }];
        const payloads = {
            "group:'Assets' before:2026-11-06 by:m": {
                groupBalances: [{ name: 'Assets', permanent: true, balances: [] }],
            },
        };
        const snapshot = await build({ ...bookPayload, groups, accounts: [] }, payloads);
        expect(snapshot.dataRange).toBeUndefined();
        expect(snapshot.roots).toEqual(['g-x']);
    });

    it('rejects balances of an account the Book did not list', async () => {
        const accounts = bookPayload.accounts?.filter(a => a.name !== 'Food');
        await expect(build({ ...bookPayload, accounts })).rejects.toThrow(
            'Account not found in the Book: Food'
        );
    });
});

describe('periodAmount', () => {
    let snapshot: Snapshot;
    const expenses = () => snapshot.groups['g-expenses'];
    const amount = (after: string | undefined, before: string) =>
        periodAmount(expenses(), { after, before }, snapshot)?.toString();

    it('sums whole months', async () => {
        snapshot = await build();
        expect(amount('2026-10-01', '2026-11-01')).toBe('1200.5');
        expect(amount('2026-01-01', '2027-01-01')).toBe('3250.75');
        expect(amount('2025-01-01', '2026-01-01')).toBe('1000');
        expect(amount(undefined, '2026-01-01')).toBe('1010');
        expect(amount('2020-01-01', '2021-01-01')).toBe('0');
    });

    it('includes the month to date up to today', async () => {
        snapshot = await build();
        expect(amount('2026-11-01', '2026-11-06')).toBe('1050.25');
        expect(amount('2026-01-01', '2026-11-06')).toBe('3250.75');
        expect(amount(undefined, '2026-11-06')).toBe('4260.75');
    });

    it('completes a comparison ending in the middle of a month with its window', async () => {
        snapshot = await build();
        expect(amount('2026-10-01', '2026-10-06')).toBe('1000');
        expect(amount('2026-07-01', '2026-08-06')).toBe('0');
        expect(amount('2025-01-01', '2025-11-06')).toBe('1000');
        expect(
            periodAmount(
                snapshot.groups['g-net'],
                { after: '2026-10-01', before: '2026-10-06' },
                snapshot
            )?.toString()
        ).toBe('4000');
    });

    it('cannot answer other partial months', async () => {
        snapshot = await build();
        expect(amount('2026-10-01', '2026-10-10')).toBeUndefined();
        expect(amount('2026-11-01', '2026-11-05')).toBeUndefined();
        expect(amount('2026-11-05', '2026-11-06')).toBeUndefined();
        expect(
            periodAmount(
                snapshot.groups['g-assets'],
                { after: '2026-10-01', before: '2026-10-06' },
                snapshot
            )
        ).toBeUndefined();
    });
});

describe('positionAmount', () => {
    it('is the cumulative balance at the end of the last month before the date', async () => {
        const snapshot = await build();
        const assets = snapshot.groups['g-assets'];
        const position = (before: string) => positionAmount(assets, before, snapshot)?.toString();
        expect(position('2026-11-06')).toBe('7849.25');
        expect(position('2027-01-01')).toBe('7849.25');
        expect(position('2026-11-01')).toBe('3899.5');
        expect(position('2026-10-01')).toBe('100');
        expect(position('2024-03-01')).toBe('0');
        expect(position('2026-10-15')).toBeUndefined();
        expect(
            positionAmount(snapshot.accounts['a-bank-b'], '2026-11-06', snapshot)?.toString()
        ).toBe('0');
    });
});

function bucket(
    year: number,
    month: number,
    period: string,
    credit: string,
    debit: string
): bkper.Balance {
    return {
        year,
        month,
        day: 0,
        fuzzyDate: year * 10000 + month * 100,
        periodBalance: period,
        cumulativeBalance: period,
        periodCredit: credit,
        periodDebit: debit,
    };
}
