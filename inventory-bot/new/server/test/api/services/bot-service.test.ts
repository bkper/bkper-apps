import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book, Group } from 'bkper-js';
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
});
