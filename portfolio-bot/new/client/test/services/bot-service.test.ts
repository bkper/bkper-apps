import { describe, expect, it } from 'bun:test';
import { Book } from 'bkper-js';
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
});
