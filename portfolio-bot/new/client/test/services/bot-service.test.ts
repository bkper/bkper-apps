import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import { botService } from '../../src/services/bot-service.js';

function createSourceBook(extra: Partial<bkper.Book> = {}): Book {
    return new Book({
        id: 'financial-book',
        name: 'Financial',
        fractionDigits: 2,
        ...extra,
    });
}

describe('legacy menu bot service', () => {
    it('selects the first Portfolio Book using the legacy collection order', () => {
        const selectedBook = createSourceBook({
            collection: {
                books: [
                    { id: 'financial-book', fractionDigits: 2 },
                    { id: 'fraction-fallback', fractionDigits: 0 },
                    {
                        id: 'explicit-stock-book',
                        fractionDigits: 2,
                        properties: { stock_book: 'true' },
                    },
                ],
            },
        });

        expect(botService.getStockBook(selectedBook)?.getId()).toBe('fraction-fallback');
        expect(botService.getStockBook(createSourceBook())).toBeNull();
    });

    it('resolves Base and Financial Books and editable currencies with legacy precedence', () => {
        const selectedBook = createSourceBook({
            collection: {
                books: [
                    {
                        id: 'usd-book',
                        fractionDigits: 2,
                        permission: Permission.EDITOR,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'brl-base-book',
                        fractionDigits: 2,
                        permission: Permission.VIEWER,
                        properties: { exc_base: 'true', exchange_code: 'BRL' },
                    },
                    {
                        id: 'first-eur-book',
                        fractionDigits: 2,
                        permission: Permission.VIEWER,
                        properties: { exc_code: 'EUR' },
                    },
                    {
                        id: 'second-eur-book',
                        fractionDigits: 2,
                        permission: Permission.OWNER,
                        properties: { exc_code: 'EUR' },
                    },
                    {
                        id: 'portfolio-book',
                        fractionDigits: 0,
                        permission: Permission.OWNER,
                        properties: { exc_code: 'QTY' },
                    },
                ],
            },
        });

        expect(botService.getBaseBook(selectedBook)?.getId()).toBe('brl-base-book');
        expect(botService.getFinancialBook(selectedBook, 'EUR')?.getId()).toBe('first-eur-book');
        expect(botService.getFinancialBook(selectedBook, 'QTY')).toBeNull();
        expect(botService.getBooksExcCodesUserCanEdit(selectedBook)).toEqual(
            new Set(['USD', 'EUR', 'QTY'])
        );
    });
});
