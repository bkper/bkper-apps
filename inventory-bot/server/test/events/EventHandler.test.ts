import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { EventHandler } from '../../src/events/handlers/EventHandler.js';
import type { EventResult } from '../../src/events/types.js';
import { AppContext } from '../../src/shared/app-context.js';

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
    readonly calls: { eventBookId: string; inventoryBookId: string }[] = [];
    interception: EventResult = { result: false };
    response: string | undefined = 'handled';
    failure: Error | undefined;

    protected override async intercept(
        _eventBook: Book,
        _event: bkper.Event
    ): Promise<EventResult> {
        return this.interception;
    }

    protected override async processObject(
        eventBook: Book,
        inventoryBook: Book,
        _event: bkper.Event
    ): Promise<string | undefined> {
        this.calls.push({
            eventBookId: eventBook.getId(),
            inventoryBookId: inventoryBook.getId(),
        });
        if (this.failure) {
            throw this.failure;
        }
        return this.response;
    }

    match(goodExcCode: string, excCode: string): boolean {
        return this.matchGoodExchange(goodExcCode, excCode);
    }
}

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({ id, name: id, properties, ...extra });
}

function createHandler(): RecordingEventHandler {
    return new RecordingEventHandler(
        new AppContext(new Bkper(), {
            ASSETS: { fetch },
        })
    );
}

function createEvent(book: Book): bkper.Event {
    return {
        type: 'TRANSACTION_CHECKED',
        book: book.json(),
        user: { username: 'tester' },
        data: { object: {} },
    };
}

describe('legacy shared event orchestration', () => {
    test('constructs the event Book from its payload and runs interception first', async () => {
        const handler = createHandler();
        handler.interception = { result: 'intercepted', warning: 'warning' };
        const eventBook = createBook('event-book');

        const result = await handler.handleEvent(createEvent(eventBook));

        expect(result).toEqual({ result: 'intercepted', warning: 'warning' });
        expect(handler.calls).toEqual([]);
    });

    test('selects the first Inventory Book and preserves the response array', async () => {
        const handler = createHandler();
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [
                        { id: 'event-book', properties: {} },
                        { id: 'inventory-first', properties: { inventory_book: 'false' } },
                        { id: 'inventory-second', properties: { inventory_book: 'true' } },
                    ],
                },
            }
        );

        const result = await handler.handleEvent(createEvent(eventBook));

        expect(handler.calls).toEqual([
            { eventBookId: 'event-book', inventoryBookId: 'inventory-first' },
        ]);
        expect(result).toEqual({ result: ['handled'] });
    });

    test('preserves warning extraction from a handler response', async () => {
        const handler = createHandler();
        handler.response = 'BUY: record / WARNING: rebuild required';
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [{ id: 'inventory', properties: { inventory_book: 'true' } }],
                },
            }
        );

        const result = await handler.handleEvent(createEvent(eventBook));

        expect(result).toEqual({
            result: ['BUY: record'],
            warning: 'WARNING: rebuild required',
        });
    });

    test('preserves error responses and caught process failures', async () => {
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [{ id: 'inventory', properties: { inventory_book: 'true' } }],
                },
            }
        );
        const responseErrorHandler = createHandler();
        responseErrorHandler.response = 'ERROR: legacy result';
        const thrownErrorHandler = createHandler();
        thrownErrorHandler.failure = new Error('legacy failure');

        expect(await responseErrorHandler.handleEvent(createEvent(eventBook))).toEqual({
            error: 'ERROR: legacy result',
        });
        expect(await thrownErrorHandler.handleEvent(createEvent(eventBook))).toEqual({
            error: 'legacy failure',
        });
    });

    test('returns false for an empty handler response', async () => {
        const handler = createHandler();
        handler.response = undefined;
        const eventBook = createBook(
            'event-book',
            {},
            {
                collection: {
                    books: [{ id: 'inventory', properties: { inventory_book: 'true' } }],
                },
            }
        );

        expect(await handler.handleEvent(createEvent(eventBook))).toEqual({ result: false });
    });

    test('preserves the missing Inventory Book response', async () => {
        const handler = createHandler();
        const eventBook = createBook(
            'event-book',
            {},
            { collection: { books: [{ id: 'financial', properties: {} }] } }
        );

        const result = await handler.handleEvent(createEvent(eventBook));

        expect(result).toEqual({
            result: 'Inventory book not found in the collection (property inventory_book = true)',
        });
        expect(handler.calls).toEqual([]);
    });

    test('preserves exchange matching semantics', () => {
        const handler = createHandler();

        expect(handler.match('USD', 'EUR')).toBe(false);
        expect(handler.match(' USD ', 'USD')).toBe(true);
        expect(handler.match('', '')).toBe(true);
    });
});
