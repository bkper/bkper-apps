import { describe, expect, it } from 'bun:test';
import { Backlog, Book, Permission } from 'bkper-js';
import { botService } from '../../src/services/bot-service.js';

function createSourceBook(extra: Partial<bkper.Book> = {}): Book {
    return new Book({
        id: 'financial-book',
        name: 'Financial',
        fractionDigits: 2,
        ...extra,
    });
}

describe('legacy Inventory menu bot service', () => {
    it('returns the first Collection Book matching either legacy Inventory role condition', () => {
        const selectedBook = createSourceBook({
            collection: {
                books: [
                    { id: 'financial-book', fractionDigits: 2 },
                    { id: 'fraction-fallback', fractionDigits: 0 },
                    {
                        id: 'explicit-inventory-book',
                        fractionDigits: 2,
                        properties: { inventory_book: 'true' },
                    },
                ],
            },
        });

        expect(botService.getInventoryBook(selectedBook)?.getId()).toBe('fraction-fallback');
        expect(botService.getInventoryBook(createSourceBook())).toBeNull();
    });

    it('resolves the first matching non-zero-fraction Financial Book', () => {
        const inventoryBook = createSourceBook({
            id: 'inventory-book',
            fractionDigits: 0,
            collection: {
                books: [
                    {
                        id: 'zero-fraction-usd',
                        fractionDigits: 0,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'usd-book',
                        fractionDigits: 2,
                        properties: { exchange_code: 'USD' },
                    },
                    {
                        id: 'later-usd-book',
                        fractionDigits: 2,
                        properties: { exc_code: 'USD' },
                    },
                ],
            },
        });

        expect(botService.getFinancialBook(inventoryBook, 'USD')?.getId()).toBe('usd-book');
        expect(botService.getFinancialBook(inventoryBook, null)).toBeNull();
        expect(botService.getFinancialBook(inventoryBook, 'EUR')).toBeNull();
    });

    it('reports edit availability for the Financial Book selected by each exchange code', () => {
        const inventoryBook = createSourceBook({
            id: 'inventory-book',
            fractionDigits: 0,
            collection: {
                books: [
                    {
                        id: 'first-usd-book',
                        fractionDigits: 2,
                        permission: Permission.VIEWER,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'later-usd-book',
                        fractionDigits: 2,
                        permission: Permission.OWNER,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'eur-book',
                        fractionDigits: 2,
                        permission: Permission.EDITOR,
                        properties: { exchange_code: 'EUR' },
                    },
                    {
                        id: 'zero-fraction-brl',
                        fractionDigits: 0,
                        permission: Permission.OWNER,
                        properties: { exc_code: 'BRL' },
                    },
                ],
            },
        });

        expect(
            botService.getEditableFinancialBookExchangeCodes(
                inventoryBook,
                new Set(['USD', 'EUR', 'BRL'])
            )
        ).toEqual(new Set(['EUR']));
    });

    it('checks only the supplied Inventory Book backlog', async () => {
        const inventoryBook = createSourceBook({ id: 'inventory-book', fractionDigits: 0 });

        inventoryBook.getBacklog = async () => new Backlog({ count: 2 });
        expect(await botService.hasPendingTasks(inventoryBook)).toBe(true);

        inventoryBook.getBacklog = async () => new Backlog({ count: 0 });
        expect(await botService.hasPendingTasks(inventoryBook)).toBe(false);

        inventoryBook.getBacklog = async () => new Backlog({});
        expect(await botService.hasPendingTasks(inventoryBook)).toBe(false);
    });
});
