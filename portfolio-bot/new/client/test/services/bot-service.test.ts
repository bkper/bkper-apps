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

    it('reports the Collection unlocked only when every lock and closing date is empty', () => {
        const unlockedBook = createSourceBook({
            collection: {
                books: [
                    { id: 'empty-dates' },
                    {
                        id: 'legacy-empty-dates',
                        lockDate: '1900-00-00',
                        closingDate: '1900-00-00',
                    },
                ],
            },
        });
        const lockedBook = createSourceBook({
            collection: {
                books: [{ id: 'locked-book', lockDate: '2026-08-25' }],
            },
        });
        const closedBook = createSourceBook({
            collection: {
                books: [{ id: 'closed-book', closingDate: '2026-08-24' }],
            },
        });

        expect(botService.areAllCollectionBooksOpenAndUnlocked(unlockedBook)).toBe(true);
        expect(botService.areAllCollectionBooksOpenAndUnlocked(lockedBook)).toBe(false);
        expect(botService.areAllCollectionBooksOpenAndUnlocked(closedBook)).toBe(false);
    });

    it('reports whether the Portfolio Book has pending tasks', async () => {
        const portfolioBook = createSourceBook({ id: 'portfolio-book', fractionDigits: 0 });

        portfolioBook.getBacklog = async () => new Backlog({ count: 2 });
        expect(await botService.hasPendingTasks(portfolioBook)).toBe(true);

        portfolioBook.getBacklog = async () => new Backlog({ count: 0 });
        expect(await botService.hasPendingTasks(portfolioBook)).toBe(false);

        portfolioBook.getBacklog = async () => new Backlog({});
        expect(await botService.hasPendingTasks(portfolioBook)).toBe(false);
    });

    it('resolves editable currencies with legacy precedence', () => {
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

        expect(botService.getBooksExcCodesUserCanEdit(selectedBook)).toEqual(
            new Set(['USD', 'EUR', 'QTY'])
        );
    });
});
