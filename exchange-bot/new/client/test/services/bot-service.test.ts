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
        const loadedBooks: Array<{ id: string; includeAccounts: boolean | undefined }> = [];
        Bkper.prototype.getBook = mock(async (id, includeAccounts) => {
            loadedBooks.push({ id, includeAccounts });
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

        expect(loadedBooks).toEqual([
            { id: 'legacy-book-id', includeAccounts: false },
            { id: 'legacy-list-one', includeAccounts: false },
            { id: 'legacy-list-two', includeAccounts: false },
        ]);
        expect(Array.from(books, connectedBook => connectedBook.getId())).toEqual([
            'legacy-book-id',
            'legacy-list-one',
            'legacy-list-two',
            'collection-brl',
        ]);
    });

    it('loads legacy connected Books in parallel while preserving discovery order', async () => {
        const resolvers = new Map<string, (book: Book) => void>();
        Bkper.prototype.getBook = mock(
            (id: string) =>
                new Promise<Book>(resolve => {
                    resolvers.set(id, resolve);
                })
        );
        const book = createBook('selected-book', {
            exc_usd_book: 'legacy-book-id',
            exc_books: 'legacy-list-one legacy-list-two',
        });

        const booksPromise = botService.getConnectedBooks(book);

        expect(Array.from(resolvers.keys())).toEqual([
            'legacy-book-id',
            'legacy-list-one',
            'legacy-list-two',
        ]);

        for (const id of ['legacy-list-two', 'legacy-book-id', 'legacy-list-one']) {
            const resolve = resolvers.get(id);
            if (!resolve) {
                throw new Error(`Missing resolver for ${id}`);
            }
            resolve(createBook(id, { exc_code: 'LEGACY' }));
        }

        const books = await booksPromise;
        expect(Array.from(books, connectedBook => connectedBook.getId())).toEqual([
            'legacy-book-id',
            'legacy-list-one',
            'legacy-list-two',
        ]);
    });

    it('limits concurrent legacy-only Book requests to five', async () => {
        const legacyBookIds = [
            'legacy-book-one',
            'legacy-book-two',
            'legacy-book-three',
            'legacy-book-four',
            'legacy-book-five',
            'legacy-book-six',
        ];
        const resolvers = new Map<string, (book: Book) => void>();
        let markLastRequestStarted = (): void => {};
        const lastRequestStarted = new Promise<void>(resolve => {
            markLastRequestStarted = resolve;
        });
        Bkper.prototype.getBook = mock(
            (id: string) =>
                new Promise<Book>(resolve => {
                    resolvers.set(id, resolve);
                    if (id === legacyBookIds[5]) {
                        markLastRequestStarted();
                    }
                })
        );
        const book = createBook('selected-book', {
            exc_books: legacyBookIds.join(' '),
        });

        const booksPromise = botService.getConnectedBooks(book);

        expect(Array.from(resolvers.keys())).toEqual(legacyBookIds.slice(0, 5));

        for (const id of legacyBookIds.slice(0, 5)) {
            const resolve = resolvers.get(id);
            if (!resolve) {
                throw new Error(`Missing resolver for ${id}`);
            }
            resolve(createBook(id, { exc_code: 'LEGACY' }));
        }
        await lastRequestStarted;
        expect(Array.from(resolvers.keys())).toEqual(legacyBookIds);

        const lastResolve = resolvers.get(legacyBookIds[5]);
        if (!lastResolve) {
            throw new Error(`Missing resolver for ${legacyBookIds[5]}`);
        }
        lastResolve(createBook(legacyBookIds[5], { exc_code: 'LEGACY' }));

        const books = await booksPromise;
        expect(Array.from(books, connectedBook => connectedBook.getId())).toEqual(legacyBookIds);
    });

    it('reuses Collection Books for legacy ids and returns each Book id once', async () => {
        const loadedIds: string[] = [];
        Bkper.prototype.getBook = mock(async id => {
            loadedIds.push(id);
            return createBook(id, { exc_code: 'LEGACY' });
        });
        const book = createBook(
            'selected-book',
            {
                exc_brl_book: 'collection-brl',
                exc_books: 'legacy-only-book collection-brl legacy-only-book collection-eur',
            },
            {
                collection: {
                    books: [
                        { id: 'selected-book', properties: { exc_code: 'USD' } },
                        { id: 'collection-eur', properties: { exc_code: 'EUR' } },
                        { id: 'collection-brl', properties: { exc_code: 'BRL' } },
                        { id: 'collection-jpy', properties: { exc_code: 'JPY' } },
                    ],
                },
            }
        );

        const books = await botService.getConnectedBooks(book);

        expect(loadedIds).toEqual(['legacy-only-book']);
        expect(Array.from(books, connectedBook => connectedBook.getId())).toEqual([
            'collection-brl',
            'legacy-only-book',
            'collection-eur',
            'collection-jpy',
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
        expect(botService.getCollectionExcCodes(book)).toEqual(new Set(['USD', 'BRL']));
        expect(await botService.getBookConfiguredExcCodes(book)).toEqual(new Set(['BRL', 'EUR']));
    });

    it('returns Books with pending tasks without requiring an exchange code', async () => {
        const firstPendingBook = createBook('first-pending-book', { exc_code: 'BRL' });
        firstPendingBook.getBacklog = mock(async () => new Backlog({ count: 1 }));
        const cleanBook = createBook('clean-book', { exc_code: 'EUR' });
        cleanBook.getBacklog = mock(async () => new Backlog({ count: 0 }));
        const secondPendingBook = createBook('second-pending-book', {
            exc_code: 'BRL',
        });
        secondPendingBook.getBacklog = mock(async () => new Backlog({ count: 1 }));
        const unconfiguredPendingBook = createBook('unconfigured-pending-book');
        unconfiguredPendingBook.getBacklog = mock(async () => new Backlog({ count: 1 }));

        const books = await botService.getBooksWithPendingTasks(
            new Set([firstPendingBook, cleanBook, secondPendingBook, unconfiguredPendingBook])
        );

        expect(books).toEqual(
            new Set([firstPendingBook, secondPendingBook, unconfiguredPendingBook])
        );
    });

    it('returns Books with event errors without requiring an exchange code', async () => {
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
        const listEventsCalls: Array<ListEventsOptions | string | null> = [];
        Book.prototype.listEvents = async function (
            ...args:
                | [ListEventsOptions]
                | [string | null, string | null, boolean | null, string | null, number, string?]
        ): Promise<EventList> {
            listEventsCalls.push(args[0]);
            const items =
                this.getId() === 'error-book' || this.getId() === 'unconfigured-book'
                    ? [{ id: 'event-id' }]
                    : [];
            return new EventList(this, { items });
        };

        const collectionBooks = book.getCollection()?.getBooks() ?? [];
        const booksWithErrors = await botService.getBooksWithEventErrors(new Set(collectionBooks));

        expect(Array.from(booksWithErrors, book => book.getId())).toEqual([
            'error-book',
            'unconfigured-book',
        ]);
        expect(listEventsCalls).toHaveLength(3);
        expect(listEventsCalls[0]).toEqual({ onError: true, limit: 1 });
    });
});
