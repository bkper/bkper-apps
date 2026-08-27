import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Amount, Book, Transaction } from 'bkper-js';
import { StockAccount } from '../../../src/api/services/stock-account.js';

function createAccount(payload: bkper.Account): Account {
    return new Account(new Book({ id: 'portfolio-book' }), payload);
}

describe('legacy StockAccount behavior', () => {
    test('exposes identity and delegates the Account update', async () => {
        const account = createAccount({
            id: 'instrument',
            name: 'Instrument',
            archived: false,
            permanent: true,
        });
        let updateCalls = 0;
        account.update = async () => {
            updateCalls++;
            return account;
        };
        const stockAccount = new StockAccount(account);

        expect(stockAccount.getId()).toBe('instrument');
        expect(stockAccount.getName()).toBe('Instrument');
        expect(stockAccount.getAccount()).toBe(account);
        expect(stockAccount.isArchived()).toBe(false);
        expect(stockAccount.isPermanent()).toBe(true);
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

    test('sets Forward Account state without persisting it', () => {
        const account = createAccount({});
        const stockAccount = new StockAccount(account);

        expect(stockAccount.getForwardedDateValue()).toBeNull();
        expect(stockAccount.setForwardedDate('2025-02-03')).toBe(stockAccount);
        expect(stockAccount.setForwardedExcRate(new Amount('1.2'))).toBe(stockAccount);
        expect(stockAccount.setForwardedPrice(new Amount('42'))).toBe(stockAccount);

        expect(stockAccount.getForwardedDate()).toBe('2025-02-03');
        expect(stockAccount.getForwardedDateValue()).toBe(20250203);
        expect(account.getProperty('forwarded_exc_rate')).toBe('1.2');
        expect(account.getProperty('forwarded_price')).toBe('42');
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

    test('trashes queued Forward history sequentially and skips already trashed entries', async () => {
        const book = new Book({ id: 'portfolio-book' });
        const account = new Account(book, { id: 'instrument' });
        const alreadyTrashed = new Transaction(book, { id: 'trashed', trashed: true });
        const checked = new Transaction(book, { id: 'checked', checked: true });
        const unchecked = new Transaction(book, { id: 'unchecked', checked: false });
        const calls: string[] = [];

        checked.uncheck = async () => {
            calls.push('uncheck:checked');
            checked.setChecked(false);
            return checked;
        };
        checked.trash = async () => {
            calls.push('trash:checked');
            return checked;
        };
        unchecked.trash = async () => {
            calls.push('trash:unchecked');
            return unchecked;
        };

        const stockAccount = new StockAccount(account);
        stockAccount.pushTrash(alreadyTrashed);
        stockAccount.pushTrash(checked);
        stockAccount.pushTrash(unchecked);
        await stockAccount.cleanTrash();

        expect(calls).toEqual(['uncheck:checked', 'trash:checked', 'trash:unchecked']);
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
