import { BalancesReport, Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    accountBalances,
    groupBalances,
    monthPeriod,
    monthPosition,
    readQueryBalances,
} from '../../src/services/balances';
import { DATA_AT, bookPayload, fixtureLedger } from '../fixtures/snapshot-book';

function read(query: string) {
    const ledger = fixtureLedger();
    return readQueryBalances(
        query,
        new BalancesReport(new Book(bookPayload), ledger.balances(query)),
        DATA_AT
    );
}

describe('readQueryBalances', () => {
    it('reads each group and account of the response with the sign Bkper shows', () => {
        const balances = read("group:'Net income' after:2026-10-01 before:2026-11-06 by:m");
        expect(balances.query).toBe("group:'Net income' after:2026-10-01 before:2026-11-06 by:m");
        expect(balances.dataAt).toBe(DATA_AT.toISOString());
        // Mixed Incoming and Outgoing follows the group's credit nature: income minus expenses.
        expect(groupBalances(balances, 'Net income')).toMatchObject({
            period: '7749.25',
            months: [
                { month: '2026-10', period: '3799.5' },
                { month: '2026-11', period: '3949.75' },
            ],
        });
        expect(accountBalances(balances, 'Rent')).toMatchObject({ period: '2000' });
        expect(accountBalances(balances, 'Salary')).toMatchObject({ period: '10000' });
    });

    it('keeps the period balance of the query and the position at its end apart', () => {
        const balances = read("group:'Assets' after:2026-11-01 before:2026-11-06 by:m");
        expect(groupBalances(balances, 'Assets')).toEqual({
            period: '3949.75',
            cumulative: '7849.25',
            months: [{ month: '2026-11', period: '3949.75', cumulative: '7849.25' }],
        });
        expect(groupBalances(balances, 'Banks')?.cumulative).toBe('7749.25');
    });

    it('tells a group or account Bkper left out from one with no balance', () => {
        const balances = read("group:'Expenses' after:2026-10-01 before:2026-11-01 by:m");
        expect(accountBalances(balances, 'Old Supplier')).toMatchObject({ period: '0' });
        expect(accountBalances(balances, 'Salary')).toBeUndefined();
        expect(groupBalances(balances, 'toString')).toBeUndefined();
    });
});

describe('monthPeriod and monthPosition', () => {
    it('read a month without a bucket as no activity, and the position carried over', () => {
        const balances = read("group:'Assets' before:2026-11-06 by:m");
        const cash = accountBalances(balances, 'Cash');
        expect(cash?.months.map(month => month.month)).toEqual(['2024-03']);
        expect(monthPeriod(cash, '2024-03')).toBe('100');
        expect(monthPeriod(cash, '2026-10')).toBe('0');
        expect(monthPosition(cash, '2026-10')).toBe('100');
        expect(monthPosition(cash, '2024-02')).toBe('0');
        expect(monthPosition(undefined, '2026-10')).toBe('0');
    });
});
