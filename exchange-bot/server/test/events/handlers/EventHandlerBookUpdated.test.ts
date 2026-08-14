import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book, Month, Period } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerBookUpdated } from '../../../src/events/handlers/EventHandlerBookUpdated.js';

class TestEventHandlerBookUpdated extends EventHandlerBookUpdated {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }
}

interface CapturedRequest {
    method: string;
    url: string;
    book: bkper.Book;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(payload: bkper.Book): Book {
    return new Book(payload);
}

function captureBookRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const book: bkper.Book = await request.clone().json();
        requests.push({ method: request.method, url: request.url, book });
        return new Response(JSON.stringify(book), {
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;
    return requests;
}

function createHandler(): TestEventHandlerBookUpdated {
    return new TestEventHandlerBookUpdated(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy Book setting synchronization behavior', () => {
    test('updates selected settings in the established order', async () => {
        const baseBook = createBook({
            id: 'base-book',
            name: 'Base Book',
            pageSize: 50,
            period: Period.YEAR,
            lockDate: '2026-01-31',
            closingDate: '2025-12-31',
            periodStartMonth: Month.APRIL,
            properties: {
                exc_code: 'USD',
                exc_rates_url: 'https://rates.test/base',
                exc_rates_cache: 'daily',
                exc_on_check: 'true',
                exc_aggregate: 'true',
            },
        });
        const connectedBook = createBook({
            id: 'connected-book',
            name: 'Connected Book',
            pageSize: 25,
            period: Period.MONTH,
            lockDate: '2025-01-31',
            closingDate: '2024-12-31',
            periodStartMonth: Month.JANUARY,
            properties: {
                exc_code: 'EUR',
                exc_rates_url: 'https://rates.test/connected',
                exc_rates_cache: 'hourly',
                exc_on_check: 'false',
                exc_aggregate: 'false',
            },
        });
        const requests = captureBookRequests();

        const result = await createHandler().processConnectedBook(baseBook, connectedBook, {
            data: { object: baseBook.json() },
        });

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>:  page size: 50 period: YEAR lock date: 2026-01-31 closing date: 2025-12-31 period start month: APRIL exc_rates_url: https://rates.test/base exc_rates_cache: daily exc_on_check: true exc_aggregate: true"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].url).toContain('/v5/books/connected-book');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].book).toMatchObject({
            pageSize: 50,
            period: Period.YEAR,
            lockDate: '2026-01-31',
            closingDate: '2025-12-31',
            periodStartMonth: Month.APRIL,
            properties: {
                exc_code: 'EUR',
                exc_rates_url: 'https://rates.test/base',
                exc_rates_cache: 'daily',
                exc_on_check: 'true',
                exc_aggregate: 'true',
            },
        });
    });

    test('does not clear exc_on_check when the source setting is absent', async () => {
        const baseBook = createBook({
            id: 'base-book',
            name: 'Base Book',
            pageSize: 50,
            period: Period.YEAR,
            periodStartMonth: Month.APRIL,
            properties: { exc_code: 'USD' },
        });
        const connectedBook = createBook({
            id: 'connected-book',
            name: 'Connected Book',
            pageSize: 50,
            period: Period.YEAR,
            periodStartMonth: Month.APRIL,
            properties: { exc_code: 'EUR', exc_on_check: 'true' },
        });
        const requests = captureBookRequests();

        const result = await createHandler().processConnectedBook(baseBook, connectedBook, {
            data: { object: baseBook.json() },
        });

        expect(result).toBeNull();
        expect(connectedBook.getProperty('exc_on_check')).toBe('true');
        expect(requests).toHaveLength(0);
    });
});
