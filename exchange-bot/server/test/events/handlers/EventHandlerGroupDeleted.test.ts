import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerGroupDeleted } from '../../../src/events/handlers/EventHandlerGroupDeleted.js';

class TestEventHandlerGroupDeleted extends EventHandlerGroupDeleted {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string, code: string): Book {
    return new Book({ id, name, properties: { exc_code: code } });
}

function createEvent(): bkper.Event {
    return { data: { object: { id: 'base-group', name: 'Revenue' } } };
}

function captureRequests(response: bkper.Group = {}): Request[] {
    const requests: Request[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        return new Response(JSON.stringify(response), {
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;
    return requests;
}

function createHandler(): TestEventHandlerGroupDeleted {
    return new TestEventHandlerGroupDeleted(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy Group deletion behavior', () => {
    test('returns the established not-found response without writing', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        connectedBook.getGroup = async () => undefined;
        const requests = captureRequests();

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent()
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: GROUP Revenue NOT Found"
        );
        expect(requests).toHaveLength(0);
    });

    test('deletes the connected Group without creating a transaction movement', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const connectedGroup = new Group(connectedBook, {
            id: 'connected-group',
            name: 'Revenue',
        });
        connectedBook.getGroup = async () => connectedGroup;
        const requests = captureRequests({ id: 'connected-group', name: 'Revenue' });

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent()
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: GROUP Revenue DELETED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('DELETE');
        expect(requests[0].url).toContain('/v5/books/connected-book/groups/connected-group');
        expect(requests[0].url).not.toContain('/transactions');
    });
});
