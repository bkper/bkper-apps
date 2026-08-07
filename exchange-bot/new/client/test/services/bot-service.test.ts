import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Backlog, Bkper, Book, EventList, Group, type ListEventsOptions } from 'bkper-js';
import { botService } from '../../src/services/bot-service.js';

const originalGetBook = Bkper.prototype.getBook;
const originalListEvents = Book.prototype.listEvents;

afterEach(() => {
    Bkper.prototype.getBook = originalGetBook;
    Book.prototype.listEvents = originalListEvents;
});

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<NonNullable<ConstructorParameters<typeof Book>[0]>> = {}
): Book {
    return new Book({
        id,
        name: id,
        properties,
        ...extra,
    });
}

describe('bot service', () => {
    it('discovers connected Books from legacy properties and Collection in order', async () => {
        const loadedIds: string[] = [];
        Bkper.prototype.getBook = mock(async id => {
            loadedIds.push(id);
            return createBook(id, { exc_code: 'LEGACY' });
        });
        const book = createBook(
            'selected-book',
            {
                exc_usd_book: 'legacy-book-id',
                exc_books: 'legacy-list-one legacy-list-two',
                exc_code: 'USD',
            },
            {
                collection: {
                    books: [
                        { id: 'selected-book', properties: { exc_code: 'USD' } },
                        { id: 'collection-brl', properties: { exc_code: 'BRL' } },
                        { id: 'collection-empty', properties: {} },
                    ],
                },
            }
        );

        const books = await botService.getConnectedBooks(book);

        expect(loadedIds).toEqual(['legacy-book-id', 'legacy-list-one', 'legacy-list-two']);
        expect(Array.from(books, connectedBook => connectedBook.getId())).toEqual([
            'legacy-book-id',
            'legacy-list-one',
            'legacy-list-two',
            'collection-brl',
        ]);
    });

    it('preserves visible and configured exchange-code rules', async () => {
        const book = createBook(
            'selected-book',
            { exc_code: 'USD' },
            {
                collection: {
                    books: [
                        {
                            id: 'base-book',
                            properties: { exc_base: 'false', exc_code: 'USD' },
                        },
                        { id: 'connected-book', properties: { exchange_code: 'BRL' } },
                        { id: 'unconfigured-book', properties: {} },
                    ],
                },
            }
        );
        book.getGroups = mock(async () => [
            new Group(book, { name: 'BRL', properties: { exc_code: 'BRL' } }),
            new Group(book, { name: 'EUR', properties: { exchange_code: 'EUR' } }),
            new Group(book, { name: 'Empty', properties: {} }),
        ]);
        expect(botService.getVisibleCollectionExcCodes(book)).toEqual(new Set(['USD', 'BRL']));
        expect(await botService.getBookConfiguredExcCodes(book)).toEqual(new Set(['BRL', 'EUR']));
    });

    it('preserves pending-task and bot-error checks', async () => {
        const book = createBook(
            'selected-book',
            { exc_code: 'USD' },
            {
                collection: {
                    books: [
                        { id: 'error-book', properties: { exc_code: 'BRL' } },
                        { id: 'clean-book', properties: { exc_code: 'EUR' } },
                        { id: 'unconfigured-book', properties: {} },
                    ],
                },
            }
        );
        book.getBacklog = mock(async () => new Backlog({ count: 1 }));
        const listEventsCalls: Array<ListEventsOptions | string | null> = [];
        Book.prototype.listEvents = async function (
            ...args:
                | [ListEventsOptions]
                | [string | null, string | null, boolean | null, string | null, number, string?]
        ): Promise<EventList> {
            listEventsCalls.push(args[0]);
            const items = this.getId() === 'error-book' ? [{ id: 'event-id' }] : [];
            return new EventList(this, { items });
        };

        expect(await botService.hasPendingTasks(book)).toBe(true);
        expect(await botService.getCollectionBooksWithErrors(book)).toEqual(new Set(['BRL']));
        expect(listEventsCalls).toHaveLength(2);
        expect(listEventsCalls[0]).toEqual({ onError: true, limit: 50 });
    });
});
