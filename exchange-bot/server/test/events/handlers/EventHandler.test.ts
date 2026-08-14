import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandler } from '../../../src/events/handlers/EventHandler.js';

const originalFetch = globalThis.fetch;
let ratesUrlSequence = 0;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

class RecordingEventHandler extends EventHandler {
    readonly calls: string[] = [];
    process?: (connectedBook: Book) => Promise<string | null>;

    protected async processObject(
        _baseBook: Book,
        connectedBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        this.calls.push(connectedBook.getId());
        if (this.process) {
            return this.process(connectedBook);
        }
        return connectedBook.getId();
    }

    getBookAnchor(book: Book): string {
        return this.buildBookAnchor(book);
    }
}

function createContext(): AppContext {
    return new AppContext(new Bkper(), {
        OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
        ASSETS: { fetch },
    });
}

function createBookPayload(id: string, properties: Record<string, string> = {}): bkper.Book {
    return {
        id,
        name: id,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties,
    };
}

function createEvent(
    book: bkper.Book,
    type: bkper.Event['type'] = 'ACCOUNT_CREATED',
    transaction: Partial<bkper.Transaction> = {}
): bkper.Event {
    return {
        type,
        book,
        user: { username: 'tester' },
        agent: { id: 'tester' },
        data: {
            object: {
                transaction: {
                    id: 'transaction-1',
                    date: '2026-01-02',
                    amount: '100',
                    description: 'Payment',
                    checked: false,
                    properties: {},
                    creditAccount: { name: 'From', groups: [], properties: {} },
                    debitAccount: { name: 'To', groups: [], properties: {} },
                    ...transaction,
                },
            },
        },
    };
}

function createCollectionEvent(
    connectedBooks: bkper.Book[],
    eventProperties: Record<string, string> = { exc_code: 'USD' },
    type: bkper.Event['type'] = 'ACCOUNT_CREATED',
    transaction: Partial<bkper.Transaction> = {}
): bkper.Event {
    const eventBook = createBookPayload('event-book', eventProperties);
    eventBook.collection = {
        books: [eventBook, ...connectedBooks],
    };
    return createEvent(eventBook, type, transaction);
}

function uniqueRatesUrl(): string {
    ratesUrlSequence += 1;
    return `https://rates.test/event-handler-${ratesUrlSequence}`;
}

describe('legacy shared event orchestration', () => {
    test('requires the event Book exchange code before orchestration', async () => {
        const handler = new RecordingEventHandler(createContext());

        const result = await handler.handleEvent(createEvent(createBookPayload('book')));

        expect(result).toBe('Please set the "exc_code" property of this book.');
        expect(handler.calls).toHaveLength(0);
    });

    test('processes eligible connected Books in order and filters empty responses', async () => {
        const handler = new RecordingEventHandler(createContext());
        handler.process = async connectedBook =>
            connectedBook.getId() === 'empty-response' ? '' : connectedBook.getId();
        const event = createCollectionEvent([
            createBookPayload('eur-book', { exc_code: 'EUR' }),
            createBookPayload('without-code'),
            createBookPayload('empty-response', { exc_code: 'BRL' }),
            createBookPayload('template', { exc_code: 'TEMPLATE' }),
        ]);

        const result = await handler.handleEvent(event);

        expect(handler.calls).toEqual(['eur-book', 'empty-response']);
        expect(result).toEqual(['eur-book']);
        expect(handler.getBookAnchor(new Book(createBookPayload('eur-book')))).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=eur-book'>eur-book</a>"
        );
    });

    test('returns false when the event Book is the only connected Book', async () => {
        const handler = new RecordingEventHandler(createContext());

        const result = await handler.handleEvent(createCollectionEvent([]));

        expect(result).toBe(false);
        expect(handler.calls).toHaveLength(0);
    });

    test('keeps unchecked posted events waiting when exchange-on-check is enabled', async () => {
        const handler = new RecordingEventHandler(createContext());
        const event = createCollectionEvent(
            [createBookPayload('eur-book', { exc_code: 'EUR' })],
            { exc_code: 'USD', exc_on_check: 'true' },
            'TRANSACTION_POSTED',
            { checked: false }
        );

        const result = await handler.handleEvent(event);

        expect(result).toBe(false);
        expect(handler.calls).toHaveLength(0);
    });

    test('preloads rates before parallel transaction processing', async () => {
        const sequence: string[] = [];
        const ratesUrl = uniqueRatesUrl();
        globalThis.fetch = (async () => {
            sequence.push('rates');
            return new Response(
                JSON.stringify({ base: 'USD', rates: { EUR: '0.5' }, status: 200 }),
                { headers: { 'content-type': 'application/json' } }
            );
        }) as unknown as typeof fetch;
        const handler = new RecordingEventHandler(createContext());
        handler.process = async connectedBook => {
            sequence.push(connectedBook.getId());
            return connectedBook.getId();
        };
        const event = createCollectionEvent(
            [createBookPayload('eur-book', { exc_code: 'EUR' })],
            { exc_code: 'USD', exc_rates_url: ratesUrl },
            'TRANSACTION_UPDATED'
        );

        const result = await handler.handleEvent(event);

        expect(sequence).toEqual(['rates', 'eur-book']);
        expect(result).toEqual(['eur-book']);
    });

    test('skips rate preloading when the event Book is the only base Book', async () => {
        let requests = 0;
        globalThis.fetch = (async () => {
            requests += 1;
            throw new Error('Rates should not be fetched');
        }) as unknown as typeof fetch;
        const handler = new RecordingEventHandler(createContext());
        const event = createCollectionEvent(
            [createBookPayload('eur-book', { exc_code: 'EUR' })],
            { exc_code: 'USD', exc_base: 'true', exc_rates_url: uniqueRatesUrl() },
            'TRANSACTION_CHECKED'
        );

        const result = await handler.handleEvent(event);

        expect(result).toEqual(['eur-book']);
        expect(requests).toBe(0);
    });

    test('processes connected Books concurrently in legacy chunks of fourteen', async () => {
        const connectedBooks = Array.from({ length: 15 }, (_, index) =>
            createBookPayload(`book-${index + 1}`, { exc_code: `C${index + 1}` })
        );
        let releaseFirstChunk: (() => void) | undefined;
        const firstChunk = new Promise<void>(resolve => {
            releaseFirstChunk = resolve;
        });
        const handler = new RecordingEventHandler(createContext());
        handler.process = async connectedBook => {
            if (connectedBook.getId() !== 'book-15') {
                await firstChunk;
            }
            return connectedBook.getId();
        };

        const resultPromise = handler.handleEvent(createCollectionEvent(connectedBooks));
        await Promise.resolve();
        await Promise.resolve();

        expect(handler.calls).toHaveLength(13);
        releaseFirstChunk?.();
        const result = await resultPromise;

        expect(handler.calls).toHaveLength(15);
        expect(result).toEqual(connectedBooks.map((_book, index) => `book-${index + 1}`));
    });
});
