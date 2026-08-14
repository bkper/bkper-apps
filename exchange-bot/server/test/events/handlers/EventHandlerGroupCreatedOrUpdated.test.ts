import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerGroupCreatedOrUpdated } from '../../../src/events/handlers/EventHandlerGroupCreatedOrUpdated.js';

class TestEventHandlerGroupCreatedOrUpdated extends EventHandlerGroupCreatedOrUpdated {
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
    group: bkper.Group;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string, code: string): Book {
    return new Book({ id, name, properties: { exc_code: code } });
}

function createEvent(group: bkper.Group, previousName?: string): bkper.Event {
    return {
        data: {
            object: group,
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function captureGroupRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const group: bkper.Group = await request.clone().json();
        requests.push({ method: request.method, url: request.url, group });
        return new Response(JSON.stringify({ id: group.id ?? 'connected-group', ...group }), {
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;
    return requests;
}

function createHandler(): TestEventHandlerGroupCreatedOrUpdated {
    return new TestEventHandlerGroupCreatedOrUpdated(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy Group create and update behavior', () => {
    test('creates a missing connected Group with hierarchy and visible properties', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const parentGroup = new Group(connectedBook, {
            id: 'connected-parent',
            name: 'Income',
        });
        connectedBook.getGroup = async name => (name === 'Income' ? parentGroup : undefined);
        const requests = captureGroupRequests();
        const baseGroup: bkper.Group = {
            id: 'base-group',
            name: 'Revenue',
            parent: { id: 'base-parent', name: 'Income' },
            hidden: true,
            properties: {
                child_book_id: 'source-child',
                report: 'Sales',
                hidden_: 'do-not-copy',
            },
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent(baseGroup)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: GROUP Revenue CREATED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toContain('/v5/books/connected-book/groups');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].group).toMatchObject({
            name: 'Revenue',
            parent: { id: 'connected-parent', name: 'Income' },
            hidden: true,
            properties: { child_book_id: '', report: 'Sales' },
        });
        expect(requests[0].group.properties?.hidden_).toBeUndefined();
    });

    test('updates a renamed connected Group and preserves its child_book_id', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const connectedGroup = new Group(connectedBook, {
            id: 'connected-group',
            name: 'Old Revenue',
            hidden: false,
            properties: { child_book_id: 'connected-child', stale: 'value' },
        });
        const parentGroup = new Group(connectedBook, {
            id: 'connected-parent',
            name: 'Income',
        });
        const lookups: (string | undefined)[] = [];
        connectedBook.getGroup = async name => {
            lookups.push(name);
            if (name === 'Old Revenue') {
                return connectedGroup;
            }
            if (name === 'Income') {
                return parentGroup;
            }
            return undefined;
        };
        const requests = captureGroupRequests();
        const baseGroup: bkper.Group = {
            id: 'base-group',
            name: 'New Revenue',
            parent: { id: 'base-parent', name: 'Income' },
            hidden: true,
            properties: { child_book_id: 'source-child', report: 'Updated Sales' },
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent(baseGroup, 'Old Revenue')
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: GROUP New Revenue UPDATED"
        );
        expect(lookups).toEqual(['New Revenue', 'Old Revenue', 'Income']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].group).toMatchObject({
            id: 'connected-group',
            name: 'New Revenue',
            parent: { id: 'connected-parent', name: 'Income' },
            hidden: true,
            properties: { child_book_id: 'connected-child', report: 'Updated Sales' },
        });
    });
});
