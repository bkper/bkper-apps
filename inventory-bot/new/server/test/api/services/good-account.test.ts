import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book, Group, Transaction } from 'bkper-js';
import { GoodAccount } from '../../../src/api/services/good-account.js';

describe('legacy GoodAccount', () => {
    test('delegates identity and preserves calculation and rebuild state', async () => {
        const book = new Book({ id: 'inventory-book' });
        const account = new Account(book, {
            id: 'item-account',
            name: 'Apple',
            type: AccountType.ASSET,
            permanent: true,
            archived: true,
            properties: {
                cogs_calc_date: '2026-03-05',
                needs_rebuild: 'TRUE',
            },
        });
        let updates = 0;
        account.update = async () => {
            updates++;
            return account;
        };
        const goodAccount = new GoodAccount(account);

        expect(goodAccount.getId()).toBe('item-account');
        expect(goodAccount.getName()).toBe('Apple');
        expect(goodAccount.getAccount()).toBe(account);
        expect(goodAccount.getNormalizedName()).toBe('apple');
        expect(goodAccount.isArchived()).toBe(true);
        expect(goodAccount.isPermanent()).toBe(true);
        expect(goodAccount.getCOGSCalculationDate()).toBe('2026-03-05');
        expect(goodAccount.getCOGSCalculationDateValue()).toBe(20260305);
        expect(goodAccount.needsRebuild()).toBe(true);

        goodAccount.clearNeedsRebuild();
        goodAccount.setCOGSCalculationDate('');
        expect(goodAccount.needsRebuild()).toBe(false);
        expect(goodAccount.getCOGSCalculationDate()).toBeUndefined();
        expect(goodAccount.getCOGSCalculationDateValue()).toBeNull();

        goodAccount.flagNeedsRebuild();
        goodAccount.deleteCOGSCalculationDate();
        expect(goodAccount.needsRebuild()).toBe(true);
        expect(goodAccount.getCOGSCalculationDate()).toBeUndefined();
        await goodAccount.update();
        expect(updates).toBe(1);
    });

    test('resolves the first non-empty Group exchange code and rejects flow Accounts', async () => {
        const book = new Book({ id: 'inventory-book' });
        const empty = new Group(book, { properties: { exc_code: ' ' } });
        const usd = new Group(book, { properties: { exc_code: 'USD' } });
        const eur = new Group(book, { properties: { exc_code: 'EUR' } });
        const item = new Account(book, { type: AccountType.ASSET });
        item.getGroups = async () => [empty, usd, eur];
        const incoming = new Account(book, { type: AccountType.INCOMING });
        incoming.getGroups = async () => [usd];

        expect(await new GoodAccount(item).getExchangeCode()).toBe('USD');
        expect(await new GoodAccount(incoming).getExchangeCode()).toBeNull();
    });

    test('cleans queued trash sequentially while preserving already trashed Transactions', async () => {
        const book = new Book({ id: 'inventory-book' });
        const account = new Account(book, { id: 'item-account' });
        const checked = new Transaction(book, { id: 'checked', checked: true });
        const unchecked = new Transaction(book, { id: 'unchecked', checked: false });
        const trashed = new Transaction(book, { id: 'trashed', trashed: true });
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
        trashed.trash = async () => {
            throw new Error('Already trashed Transaction must be skipped');
        };
        const goodAccount = new GoodAccount(account);
        goodAccount.pushTrash(checked);
        goodAccount.pushTrash(unchecked);
        goodAccount.pushTrash(trashed);

        await goodAccount.cleanTrash();

        expect(calls).toEqual(['uncheck:checked', 'trash:checked', 'trash:unchecked']);
    });
});
