import { describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
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
    test('deduplicates legacy and Collection connections by ID in first-discovery order', async () => {
        const book = new Book({
            id: 'selected-book',
            properties: {
                exc_eur_book: 'legacy-eur-book',
                exc_duplicate_book: 'legacy-eur-book',
                exc_books: 'legacy-brl-book,legacy-eur-book legacy-brl-book',
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
        const loadedBooks: Book[] = [];
        const bkper = new Bkper();
        bkper.getBook = async id => {
            const loadedBook = new Book({ id, name: `Loaded ${id}` });
            loadedBooks.push(loadedBook);
            return loadedBook;
        };

        const books = Array.from(await createService(bkper).getConnectedBooks(book));

        expect(books.map(connectedBook => connectedBook.getId())).toEqual([
            'legacy-eur-book',
            'legacy-brl-book',
            'collection-jpy-book',
        ]);
        expect(loadedBooks.map(loadedBook => loadedBook.getId())).toEqual([
            'legacy-eur-book',
            'legacy-brl-book',
        ]);
        expect(books[0]).toBe(loadedBooks[0]);
        expect(books[1]).toBe(loadedBooks[1]);
    });

    test('preserves the legacy exchange-code alias and historical flag handling', () => {
        const book = new Book({
            properties: {
                exchange_code: 'USD',
                exc_historical: ' TrUe ',
            },
        });
        const service = createService();

        expect(service.getBaseCode(book)).toBe('USD');
        expect(service.isHistorical(book)).toBe(true);
    });
});
