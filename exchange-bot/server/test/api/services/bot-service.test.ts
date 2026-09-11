import { describe, expect, test } from 'bun:test';
import { Bkper, BkperError, Book } from 'bkper-js';
import { BotService } from '../../../src/api/services/bot-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

function createService(bkper = new Bkper()): BotService {
    return new BotService(
        new AppContext(bkper, {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy menu bot service', () => {
    test('reuses Collection Books and loads only unique missing legacy IDs sequentially', async () => {
        const book = new Book({
            id: 'selected-book',
            properties: {
                exc_eur_book: 'legacy-eur-book',
                exc_duplicate_book: 'legacy-eur-book',
                exc_books:
                    'legacy-brl-book,legacy-eur-book legacy-brl-book legacy-only-one legacy-only-two legacy-only-one',
            },
            collection: {
                books: [
                    { id: 'selected-book', properties: { exc_code: 'USD' } },
                    { id: 'collection-jpy-book', properties: { exc_code: 'JPY' } },
                    { id: 'legacy-brl-book', properties: { exc_code: 'BRL' } },
                    { id: 'legacy-eur-book', properties: { exc_code: 'EUR' } },
                    { id: 'collection-jpy-book', properties: { exc_code: 'JPY' } },
                    { id: 'unconfigured-book', properties: {} },
                ],
            },
        });
        const collection = book.getCollection()!;
        const collectionBooks = collection.getBooks();
        collection.getBooks = () => collectionBooks;
        const loadedBooks: Book[] = [];
        let loading = false;
        const bkper = new Bkper();
        bkper.getBook = async (id, includeAccounts, includeGroups) => {
            expect(includeAccounts).not.toBe(true);
            expect(includeGroups).not.toBe(true);
            expect(loading).toBe(false);
            loading = true;
            await Promise.resolve();
            loading = false;
            const loadedBook = new Book({ id, name: `Loaded ${id}` });
            loadedBooks.push(loadedBook);
            return loadedBook;
        };

        const books = Array.from(await createService(bkper).getConnectedBooks(book));

        expect(books.map(connectedBook => connectedBook.getId())).toEqual([
            'legacy-eur-book',
            'legacy-brl-book',
            'legacy-only-one',
            'legacy-only-two',
            'collection-jpy-book',
        ]);
        expect(loadedBooks.map(loadedBook => loadedBook.getId())).toEqual([
            'legacy-only-one',
            'legacy-only-two',
        ]);
        expect(books[0]).toBe(collectionBooks[3]);
        expect(books[1]).toBe(collectionBooks[2]);
        expect(books[2]).toBe(loadedBooks[0]);
        expect(books[3]).toBe(loadedBooks[1]);
        expect(books[4]).toBe(collectionBooks[1]);
    });

    test('skips missing legacy Books and continues to valid legacy and Collection Books', async () => {
        const book = new Book({
            id: 'selected-book',
            properties: {
                exc_usd_book: 'missing-legacy-book',
                exc_books: 'USD Consolidado legacy-usd-book',
            },
            collection: {
                books: [{ id: 'collection-brl', properties: { exc_code: 'BRL' } }],
            },
        });
        const loadedIds: string[] = [];
        const bkper = new Bkper();
        bkper.getBook = async id => {
            loadedIds.push(id);
            if (id !== 'legacy-usd-book') {
                throw new BkperError(404, `Book NOT found! ID: ${id}`);
            }
            return new Book({ id, properties: { exc_code: 'USD' } });
        };

        const books = Array.from(await createService(bkper).getConnectedBooks(book));

        expect(loadedIds).toEqual(['missing-legacy-book', 'Consolidado', 'legacy-usd-book']);
        expect(books.map(connectedBook => connectedBook.getId())).toEqual([
            'legacy-usd-book',
            'collection-brl',
        ]);
    });

    test('propagates non-404 errors from legacy Book lookups', async () => {
        const error = new BkperError(403, 'Permission denied');
        const bkper = new Bkper();
        bkper.getBook = async () => {
            throw error;
        };
        const book = new Book({ properties: { exc_books: 'legacy-usd-book' } });

        await expect(createService(bkper).getConnectedBooks(book)).rejects.toBe(error);
    });

    test('ignores empty and whitespace-only legacy IDs without fetching Books', async () => {
        const book = new Book({
            id: 'selected-book',
            properties: { exc_empty_book: '', exc_blank_book: ' \t ', exc_books: ' ,  , ' },
        });
        const bkper = new Bkper();
        bkper.getBook = async id => {
            throw new Error(`Unexpected Book load: ${id}`);
        };

        const books = await createService(bkper).getConnectedBooks(book);

        expect(books.size).toBe(0);
    });

    test('preserves the legacy exchange-code alias and historical flag handling', () => {
        const book = new Book({
            properties: {
                exchange_code: 'USD',
                exc_historical: ' TrUe ',
            },
        });
        const service = createService();

        expect(service.getExcCode(book)).toBe('USD');
        expect(service.isHistorical(book)).toBe(true);
    });
});
