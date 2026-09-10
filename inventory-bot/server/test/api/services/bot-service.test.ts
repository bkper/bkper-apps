import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book, Group, Transaction } from 'bkper-js';
import { BotService } from '../../../src/api/services/bot-service.js';

describe('legacy menu bot service', () => {
    test('resolves the first matching non-zero-fraction Financial Book', () => {
        const inventoryBook = new Book({
            id: 'inventory-book',
            collection: {
                books: [
                    {
                        id: 'zero-fraction-usd',
                        fractionDigits: 0,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'first-usd',
                        fractionDigits: 2,
                        properties: { exchange_code: 'USD' },
                    },
                    {
                        id: 'later-usd',
                        fractionDigits: 2,
                        properties: { exc_code: 'USD' },
                    },
                ],
            },
        });
        const service = new BotService();

        expect(service.getFinancialBook(inventoryBook, 'USD')?.getId()).toBe('first-usd');
        expect(service.getFinancialBook(inventoryBook, 'EUR')).toBeNull();
        expect(service.getFinancialBook(inventoryBook, null)).toBeNull();
        expect(service.getFinancialBook(new Book({ id: 'standalone' }), 'USD')).toBeNull();
    });

    test('resolves Account exchange codes in Group order and rejects non-permanent types', async () => {
        const book = new Book({ id: 'inventory-book' });
        const emptyGroup = new Group(book, { properties: { exc_code: '  ' } });
        const usdGroup = new Group(book, { properties: { exc_code: 'USD' } });
        const eurGroup = new Group(book, { properties: { exc_code: 'EUR' } });
        const asset = new Account(book, { type: AccountType.ASSET });
        asset.getGroups = async () => [emptyGroup, usdGroup, eurGroup];
        const liability = new Account(book, { type: AccountType.LIABILITY });
        liability.getGroups = async () => [eurGroup];
        const incoming = new Account(book, { type: AccountType.INCOMING });
        incoming.getGroups = async () => [usdGroup];
        const outgoing = new Account(book, { type: AccountType.OUTGOING });
        outgoing.getGroups = async () => [usdGroup];
        const service = new BotService();

        expect(await service.getAccountExcCode(asset)).toBe('USD');
        expect(await service.getAccountExcCode(liability)).toBe('EUR');
        expect(await service.getAccountExcCode(incoming)).toBeNull();
        expect(await service.getAccountExcCode(outgoing)).toBeNull();
    });

    test('preserves posted purchase, sale, and quantity credit-note recognition', async () => {
        const book = new Book({ id: 'inventory-book' });
        const item = new Account(book, { type: AccountType.ASSET });
        const buy = new Account(book, { type: AccountType.INCOMING });
        const sell = new Account(book, { type: AccountType.OUTGOING });
        const purchase = new Transaction(book, { posted: true });
        purchase.getCreditAccount = async () => buy;
        purchase.getDebitAccount = async () => item;
        const sale = new Transaction(book, { posted: true });
        sale.getCreditAccount = async () => item;
        sale.getDebitAccount = async () => sell;
        const creditNote = new Transaction(book, {
            posted: true,
            properties: { credit_note: 'credit-1' },
        });
        creditNote.getCreditAccount = async () => item;
        creditNote.getDebitAccount = async () => buy;
        const draft = new Transaction(book, { posted: false });
        draft.getCreditAccount = async () => buy;
        draft.getDebitAccount = async () => item;
        const service = new BotService();

        expect(await service.isPurchase(purchase)).toBe(true);
        expect(await service.isSale(sale)).toBe(true);
        expect(await service.isCreditNote(creditNote)).toBe(true);
        expect(await service.isPurchase(draft)).toBe(false);
    });

    test('preserves FIFO precedence and calculates the exclusive before date', () => {
        const book = new Book({ id: 'inventory-book' });
        const service = new BotService();
        const transaction = (
            dateValue: number,
            order: string | undefined,
            createdMilliseconds: number
        ): Transaction => {
            const tx = new Transaction(book, { properties: order ? { order } : {} });
            tx.getDateValue = () => dateValue;
            tx.getCreatedAt = () => new Date(2026, 0, 1, 0, 0, 0, createdMilliseconds);
            return tx;
        };
        const earlierDate = transaction(20260301, '9', 900);
        const laterDate = transaction(20260302, '1', 100);
        const earlierOrder = transaction(20260301, '1', 900);
        const laterOrder = transaction(20260301, '2', 100);
        const earlierCreation = transaction(20260301, undefined, 100);
        const laterCreation = transaction(20260301, undefined, 900);

        expect(service.compareToFIFO(earlierDate, laterDate)).toBeLessThan(0);
        expect(service.compareToFIFO(earlierOrder, laterOrder)).toBeLessThan(0);
        expect(service.compareToFIFO(earlierCreation, laterCreation)).toBeLessThan(0);
        expect(service.getBeforeDateIsoString(book, '2026-03-31')).toBe('2026-04-01');
    });
});
