import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book } from 'bkper-js';
import { StockAccount } from '../../../src/api/services/stock-account.js';

function createAccount(payload: bkper.Account): Account {
    return new Account(new Book({ id: 'portfolio-book' }), payload);
}

describe('legacy StockAccount behavior', () => {
    test('exposes identity and delegates the Account update', async () => {
        const account = createAccount({ id: 'instrument', name: 'Instrument' });
        let updateCalls = 0;
        account.update = async () => {
            updateCalls++;
            return account;
        };
        const stockAccount = new StockAccount(account);

        expect(stockAccount.getId()).toBe('instrument');
        expect(stockAccount.getName()).toBe('Instrument');
        await expect(stockAccount.update()).resolves.toBe(account);
        expect(updateCalls).toBe(1);
    });

    test('reads legacy and current realized dates and rebuild state', () => {
        const legacyAccount = createAccount({
            properties: {
                stock_realized_date: '20240203',
                realized_date: '2025-01-01',
                needs_rebuild: 'TRUE',
            },
        });
        const currentAccount = createAccount({
            properties: { realized_date: '2025-01-02', needs_rebuild: 'FALSE' },
        });
        const emptyAccount = createAccount({});

        expect(new StockAccount(legacyAccount).getRealizedDate()).toBe('2024-02-03');
        expect(new StockAccount(legacyAccount).getRealizedDateValue()).toBe(20240203);
        expect(new StockAccount(legacyAccount).needsRebuild()).toBe(true);
        expect(new StockAccount(currentAccount).getRealizedDate()).toBe('2025-01-02');
        expect(new StockAccount(currentAccount).getRealizedDateValue()).toBe(20250102);
        expect(new StockAccount(currentAccount).needsRebuild()).toBe(false);
        expect(new StockAccount(emptyAccount).getRealizedDate()).toBeUndefined();
        expect(new StockAccount(emptyAccount).getRealizedDateValue()).toBeNull();
        expect(new StockAccount(emptyAccount).needsRebuild()).toBe(false);
    });

    test('sets and deletes realized dates with legacy property cleanup', () => {
        const account = createAccount({
            properties: {
                last_sale_date: '2024-01-01',
                stock_realized_date: '20240102',
                realized_date: '2024-01-03',
            },
        });
        const stockAccount = new StockAccount(account);

        expect(stockAccount.setRealizedDate('2025-02-03')).toBe(stockAccount);
        expect(account.getProperty('last_sale_date')).toBeUndefined();
        expect(account.getProperty('stock_realized_date')).toBeUndefined();
        expect(account.getProperty('realized_date')).toBe('2025-02-03');

        expect(stockAccount.deleteRealizedDate()).toBe(stockAccount);
        expect(account.getProperty('last_sale_date')).toBeUndefined();
        expect(account.getProperty('stock_realized_date')).toBeUndefined();
        expect(account.getProperty('realized_date')).toBeUndefined();
    });

    test('clears Reset and Full Reset Account state without persisting it', () => {
        const account = createAccount({
            properties: {
                needs_rebuild: 'TRUE',
                forwarded_date: '2025-02-03',
                forwarded_exc_rate: '1.2',
                forwarded_price: '42',
            },
        });
        let updateCalls = 0;
        account.update = async () => {
            updateCalls++;
            return account;
        };
        const stockAccount = new StockAccount(account);

        stockAccount.clearNeedsRebuild();
        expect(stockAccount.getForwardedDate()).toBe('2025-02-03');
        expect(stockAccount.deleteForwardedDate()).toBe(stockAccount);
        expect(stockAccount.deleteForwardedExcRate()).toBe(stockAccount);
        expect(stockAccount.deleteForwardedPrice()).toBe(stockAccount);

        expect(account.getProperty('needs_rebuild')).toBeUndefined();
        expect(account.getProperty('forwarded_date')).toBeUndefined();
        expect(account.getProperty('forwarded_exc_rate')).toBeUndefined();
        expect(account.getProperty('forwarded_price')).toBeUndefined();
        expect(updateCalls).toBe(0);
    });

    test('selects the first nonblank exchange Group for permanent Accounts', async () => {
        const book = new Book({
            id: 'portfolio-book',
            groups: [
                { id: 'blank', properties: { stock_exc_code: '  ' } },
                { id: 'eur', properties: { stock_exc_code: ' EUR ' } },
                { id: 'usd', properties: { stock_exc_code: 'USD' } },
            ],
            accounts: [
                {
                    id: 'instrument',
                    type: AccountType.ASSET,
                    groups: [{ id: 'blank' }, { id: 'eur' }, { id: 'usd' }],
                },
            ],
        });
        const account = await book.getAccount('instrument');
        if (!account) {
            throw new Error('Expected Account fixture');
        }

        await expect(new StockAccount(account).getExchangeCode()).resolves.toBe(' EUR ');
    });

    test('does not inspect Groups for non-permanent Account types', async () => {
        for (const type of [AccountType.INCOMING, AccountType.OUTGOING]) {
            const account = createAccount({ id: type, type });
            account.getGroups = async () => {
                throw new Error('Groups must not be loaded');
            };

            await expect(new StockAccount(account).getExchangeCode()).resolves.toBeNull();
        }
    });
});
