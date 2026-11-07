import { BalancesReport, Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, quote, snapshotQueries } from '../../src/services/snapshot';
import { TODAY, bookPayload, fixtureLedger } from '../fixtures/snapshot-book';

const DATA_AT = new Date('2026-11-05T15:00:00Z');

/** The fixture's map, or one of another Book whose root queries answer `balances`. */
async function build(payload: bkper.Book = bookPayload, balances?: Record<string, bkper.Balances>) {
    const ledger = fixtureLedger();
    const book = new Book(payload);
    const groups = await book.getGroups();
    const accounts = await book.getAccounts();
    const roots = groups.filter(group => !group.hasParent());
    const results = snapshotQueries(
        roots.map(root => ({ name: root.getName() ?? '' })),
        TODAY
    ).map(query => {
        const answer = balances ? balances[query.query] : ledger.balances(query.query);
        if (!answer) {
            throw new Error(`No balances for ${query.query}`);
        }
        return { query, report: new BalancesReport(book, answer) };
    });
    return buildSnapshot({ book, groups, accounts, results, today: TODAY, dataAt: DATA_AT });
}

describe('snapshotQueries', () => {
    it('reads every root by month up to today, one query per root', () => {
        const queries = snapshotQueries([{ name: 'Assets' }, { name: 'Expenses' }], TODAY);
        expect(queries).toEqual([
            { root: 'Assets', query: "group:'Assets' before:2026-11-06 by:m" },
            { root: 'Expenses', query: "group:'Expenses' before:2026-11-06 by:m" },
        ]);
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
        expect(accounts['a-card']).toMatchObject({
            type: 'LIABILITY',
            credit: true,
            activeMonths: [],
        });
        expect(Object.keys(accounts)).toHaveLength(8);
    });

    it('keeps the accounts in no group apart, with their nature and no months', async () => {
        const { accounts, ungrouped } = await build();
        expect(ungrouped).toEqual({
            'a-owner': {
                id: 'a-owner',
                name: 'Owner',
                type: 'LIABILITY',
                credit: true,
                permanent: true,
                archived: false,
            },
        });
        expect(accounts['a-owner']).toBeUndefined();
    });

    it('holds the months each group and account had movements in, and no amounts', async () => {
        const { groups, accounts } = await build();
        expect(groups['g-expenses'].activeMonths).toEqual([
            '2024-03',
            '2025-11',
            '2026-08',
            '2026-10',
            '2026-11',
        ]);
        expect(accounts['a-food'].activeMonths).toEqual(['2026-10', '2026-11']);
        expect(accounts['a-bank-b'].activeMonths).toEqual([]);
        expect(groups['g-net'].activeMonths).toEqual(['2025-11', '2026-08', '2026-10', '2026-11']);
        // An account under several roots appears once.
        expect(Object.values(accounts).filter(account => account.name === 'Rent')).toHaveLength(1);
        const values = JSON.stringify({ groups, accounts });
        for (const amount of ['1000', '200.5', '3949.75']) {
            expect(values).not.toContain(amount);
        }
    });

    it('counts a month whose movements net to zero as a month with movements', async () => {
        const groups = [
            { id: 'g-x', name: 'Expenses', type: 'OUTGOING' as const, permanent: false },
        ];
        const payloads = {
            "group:'Expenses' before:2026-11-06 by:m": {
                groupBalances: [
                    {
                        name: 'Expenses',
                        credit: false,
                        permanent: false,
                        balances: [bucket(2026, 3, '0', '25', '25')],
                        accountBalances: [],
                    },
                ],
            },
        };
        const snapshot = await build({ ...bookPayload, groups, accounts: [] }, payloads);
        expect(snapshot.groups['g-x'].activeMonths).toEqual(['2026-03']);
    });

    it('spans the data range over months with movements in any root', async () => {
        expect((await build()).dataRange).toEqual({
            firstMonth: '2024-03',
            lastMonth: '2026-11',
            activeMonths: ['2024-03', '2025-11', '2026-08', '2026-10', '2026-11'],
        });
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
        for (const query of snapshotQueries([{ name: 'Expenses' }], TODAY)) {
            payloads[query.query] = { groupBalances: old('Expenses') };
        }
        const snapshot = await build({ ...bookPayload, groups, accounts: [] }, payloads);
        expect(snapshot.dataRange).toEqual({
            firstMonth: '2019-04',
            lastMonth: '2019-04',
            activeMonths: ['2019-04'],
        });
    });

    it('pads early years and keeps implausible years out of the data range', async () => {
        // A typo such as year 0012 instead of 2012 is real data: its amounts stay, its
        // month reads 0012-10, but it must not stretch the range back two thousand years.
        const balances = [
            bucket(12, 10, '-500', '0', '500'),
            bucket(2019, 4, '-50', '0', '50'),
            bucket(2026, 11, '0', '0', '0'),
        ];
        const groups = [
            { id: 'g-x', name: 'Expenses', type: 'OUTGOING' as const, permanent: false },
        ];
        const payloads: Record<string, bkper.Balances> = {};
        for (const query of snapshotQueries([{ name: 'Expenses' }], TODAY)) {
            payloads[query.query] = {
                groupBalances: [
                    {
                        name: 'Expenses',
                        credit: false,
                        permanent: false,
                        balances,
                        accountBalances: [],
                    },
                ],
            };
        }
        const snapshot = await build({ ...bookPayload, groups, accounts: [] }, payloads);
        expect(snapshot.groups['g-x'].activeMonths).toEqual(['0012-10', '2019-04']);
        expect(snapshot.dataRange).toEqual({
            firstMonth: '2019-04',
            lastMonth: '2019-04',
            activeMonths: ['2019-04'],
        });
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
