import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { EventHandler } from '../../../src/events/handlers/EventHandler.js';
import type { EventResult } from '../../../src/events/types.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;

beforeEach(() => {
    console.time = () => undefined;
    console.timeEnd = () => undefined;
});

afterEach(() => {
    console.time = originalConsoleTime;
    console.timeEnd = originalConsoleTimeEnd;
});

class RecordingEventHandler extends EventHandler {
    readonly calls: { baseBookId: string; stockBookId: string }[] = [];
    interception: EventResult = { result: false };
    response: string | null = 'handled';

    protected override async intercept(_baseBook: Book, _event: bkper.Event): Promise<EventResult> {
        return this.interception;
    }

    protected override async processObject(
        baseBook: Book,
        stockBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        this.calls.push({ baseBookId: baseBook.getId(), stockBookId: stockBook.getId() });
        return this.response;
    }

    match(stockExcCode?: string | null, excCode?: string | null): boolean {
        return this.matchStockExchange(stockExcCode, excCode);
    }

    anchor(book: Book): string {
        return this.buildBookAnchor(book);
    }
}

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({
        id,
        name: id,
        fractionDigits: 2,
        properties,
        ...extra,
    });
}

function createHandler(baseBook: Book): { handler: RecordingEventHandler; loadedIds: string[] } {
    const bkper = new Bkper();
    const loadedIds: string[] = [];
    bkper.getBook = async id => {
        loadedIds.push(id);
        return baseBook;
    };
    return {
        handler: new RecordingEventHandler(
            new AppContext(bkper, {
                ASSETS: { fetch },
            })
        ),
        loadedIds,
    };
}

function createEvent(): bkper.Event {
    return {
        type: 'ACCOUNT_CREATED',
        bookId: 'event-book-id',
        user: { username: 'tester' },
        agent: { id: 'tester' },
        data: { object: {} },
    };
}

describe('legacy shared event orchestration', () => {
    test('loads the event Book, runs interception first, and returns an accepted interception', async () => {
        const { handler, loadedIds } = createHandler(createBook('event-book'));
        handler.interception = { result: 'intercepted', warning: 'warning' };

        const result = await handler.handleEvent(createEvent());

        expect(loadedIds).toEqual(['event-book-id']);
        expect(result).toEqual({ result: 'intercepted', warning: 'warning' });
        expect(handler.calls).toEqual([]);
    });

    test('selects one Portfolio Book and preserves the response array', async () => {
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [
                        { id: 'event-book', fractionDigits: 2, properties: {} },
                        { id: 'portfolio', fractionDigits: 0, properties: {} },
                    ],
                },
            }
        );
        const { handler } = createHandler(eventBook);

        const result = await handler.handleEvent(createEvent());

        expect(handler.calls).toEqual([{ baseBookId: 'event-book', stockBookId: 'portfolio' }]);
        expect(result).toEqual({ result: ['handled'] });
    });

    test('returns false for an empty handler response', async () => {
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [{ id: 'portfolio', properties: { stock_book: 'true' } }],
                },
            }
        );
        const { handler } = createHandler(eventBook);
        handler.response = null;

        const result = await handler.handleEvent(createEvent());

        expect(result).toEqual({ result: false });
    });

    test('preserves the missing Portfolio Book response', async () => {
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [{ id: 'financial', fractionDigits: 2, properties: {} }],
                },
            }
        );
        const { handler } = createHandler(eventBook);

        const result = await handler.handleEvent(createEvent());

        expect(result).toEqual({
            result: 'No book with 0 decimal places found in the collection',
        });
        expect(handler.calls).toEqual([]);
    });

    test('preserves exchange matching and legacy Book anchors', () => {
        const { handler } = createHandler(createBook('event-book'));

        expect(handler.match(undefined, 'USD')).toBe(false);
        expect(handler.match(' ', 'USD')).toBe(false);
        expect(handler.match('USD', 'EUR')).toBe(false);
        expect(handler.match(' USD ', 'USD')).toBe(true);
        expect(handler.match('USD', undefined)).toBe(true);
        expect(handler.anchor(createBook('book id'))).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=book id'>book id</a>"
        );
    });
});
