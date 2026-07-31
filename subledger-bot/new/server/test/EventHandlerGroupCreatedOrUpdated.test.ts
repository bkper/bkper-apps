import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerGroupCreatedOrUpdated } from '../src/events/handlers/EventHandlerGroupCreatedOrUpdated';

interface CapturedRequest {
    method: string;
    url: string;
    payload?: bkper.Account | bkper.Group;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string): Book {
    return new Book({ id, name });
}

function buildEvent(
    group: bkper.Group,
    previousAttributes?: { [name: string]: string }
): bkper.Event {
    return {
        data: {
            object: group,
            previousAttributes,
        },
    };
}

function captureResourceRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];

    globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const payload: bkper.Account | bkper.Group | undefined =
                request.method === 'DELETE' ? undefined : await request.clone().json();
            requests.push({ method: request.method, url: request.url, payload });
            return new Response(
                JSON.stringify({
                    id:
                        payload?.id ??
                        (request.url.includes('/groups') ? 'child-group' : 'parent-account'),
                    ...payload,
                }),
                { headers: { 'content-type': 'application/json' } }
            );
        },
        { preconnect: originalFetch.preconnect }
    );

    return requests;
}

function createHandler(bkper = new Bkper()): EventHandlerGroupCreatedOrUpdated {
    return new EventHandlerGroupCreatedOrUpdated(new AppContext(bkper));
}

describe('EventHandlerGroupCreatedOrUpdated legacy behavior', () => {
    test('creates a child Group with visible properties except child_book_id', async () => {
        const parentBook = createBook('parent-book', 'Parent Book');
        const childBook = createBook('child-book', 'Child Book');
        childBook.getGroup = async () => undefined;
        const requestedBookIds: string[] = [];
        const bkper = new Bkper();
        bkper.getBook = async id => {
            requestedBookIds.push(id);
            return childBook;
        };
        const requests = captureResourceRequests();
        const parentGroup: bkper.Group = {
            id: 'parent-group',
            name: 'Revenue',
            properties: {
                child_book_id: 'child-book',
                report: 'Sales',
                hidden_: 'do-not-copy',
            },
        };

        const result = await createHandler(bkper).processParentBookEvent(
            parentBook,
            buildEvent(parentGroup)
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=child-book'>Child Book</a>: CHILD GROUP Revenue CREATED"
        );
        expect(requestedBookIds).toEqual(['child-book']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/child-book/groups?');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].payload).toMatchObject({
            name: 'Revenue',
            properties: { report: 'Sales' },
        });
        expect(requests[0].payload?.properties?.child_book_id).toBe('');
        expect(requests[0].payload?.properties?.hidden_).toBeUndefined();
    });

    test('finds a renamed child Group by its previous name and updates it', async () => {
        const parentBook = createBook('parent-book', 'Parent Book');
        const childBook = createBook('child-book', 'Child Book');
        const childGroup = new Group(childBook, {
            id: 'child-group',
            name: 'Old Revenue',
            properties: { stale: 'value' },
        });
        const groupLookups: (string | undefined)[] = [];
        childBook.getGroup = async name => {
            groupLookups.push(name);
            return name === 'Old Revenue' ? childGroup : undefined;
        };
        const bkper = new Bkper();
        bkper.getBook = async () => childBook;
        const requests = captureResourceRequests();
        const parentGroup: bkper.Group = {
            id: 'parent-group',
            name: 'New Revenue',
            properties: { child_book_id: 'child-book', report: 'Updated Sales' },
        };

        const result = await createHandler(bkper).processParentBookEvent(
            parentBook,
            buildEvent(parentGroup, { name: 'Old Revenue' })
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=child-book'>Child Book</a>: CHILD GROUP New Revenue UPDATED"
        );
        expect(groupLookups).toEqual(['New Revenue', 'Old Revenue']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/child-book/groups?');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].payload).toMatchObject({
            id: 'child-group',
            name: 'New Revenue',
            properties: { report: 'Updated Sales' },
        });
        expect(requests[0].payload?.properties?.child_book_id).toBe('');
    });

    test('creates a parent Account from a child Group parent_account property', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childGroupResource = new Group(childBook, {
            id: 'child-group',
            name: 'Travel Expenses',
            type: AccountType.OUTGOING,
        });
        const groupLookups: (string | undefined)[] = [];
        childBook.getGroup = async id => {
            groupLookups.push(id);
            return id === 'child-group' ? childGroupResource : undefined;
        };
        const accountLookups: (string | undefined)[] = [];
        parentBook.getAccount = async name => {
            accountLookups.push(name);
            return undefined;
        };
        const requests = captureResourceRequests();
        const childGroup: bkper.Group = {
            id: 'child-group',
            name: 'Travel Expenses',
            properties: { parent_account: 'Travel' },
        };

        const result = await createHandler().processChildBookEvent(
            childBook,
            parentBook,
            buildEvent(childGroup)
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=parent-book'>Parent Book</a>: PARENT ACCOUNT Travel CREATED"
        );
        expect(accountLookups).toEqual(['Travel']);
        expect(groupLookups).toEqual(['child-group']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/parent-book/accounts?');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].payload).toMatchObject({
            name: 'Travel',
            type: AccountType.OUTGOING,
        });
    });

    test('finds a parent Account by the previous parent_account and updates it', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childGroupResource = new Group(childBook, {
            id: 'child-group',
            name: 'Services',
            type: AccountType.INCOMING,
        });
        childBook.getGroup = async id => (id === 'child-group' ? childGroupResource : undefined);
        const parentAccount = new Account(parentBook, {
            id: 'parent-account',
            name: 'Old Services',
            type: AccountType.ASSET,
        });
        const accountLookups: (string | undefined)[] = [];
        parentBook.getAccount = async name => {
            accountLookups.push(name);
            return name === 'Old Services' ? parentAccount : undefined;
        };
        const requests = captureResourceRequests();
        const childGroup: bkper.Group = {
            id: 'child-group',
            name: 'Services',
            properties: { parent_account: 'New Services' },
        };

        const result = await createHandler().processChildBookEvent(
            childBook,
            parentBook,
            buildEvent(childGroup, { parent_account: 'Old Services' })
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=parent-book'>Parent Book</a>: PARENT ACCOUNT New Services UPDATED"
        );
        expect(accountLookups).toEqual(['New Services', 'Old Services']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/parent-book/accounts?');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].payload).toMatchObject({
            id: 'parent-account',
            name: 'New Services',
            type: AccountType.INCOMING,
        });
    });

    test('does nothing when Group relationship properties are absent', async () => {
        const parentBook = createBook('parent-book', 'Parent Book');
        const childBook = createBook('child-book', 'Child Book');
        const requestedBookIds: string[] = [];
        const bkper = new Bkper();
        bkper.getBook = async id => {
            requestedBookIds.push(id);
            return childBook;
        };
        const accountLookups: (string | undefined)[] = [];
        parentBook.getAccount = async name => {
            accountLookups.push(name);
            return undefined;
        };
        const requests = captureResourceRequests();
        const handler = createHandler(bkper);

        const parentResult = await handler.processParentBookEvent(
            parentBook,
            buildEvent(
                { id: 'parent-group', name: 'Unlinked', properties: {} },
                { child_book_id: 'old-child-book' }
            )
        );
        const childResult = await handler.processChildBookEvent(
            childBook,
            parentBook,
            buildEvent(
                { id: 'child-group', name: 'Unlinked', properties: {} },
                { parent_account: 'Old Parent' }
            )
        );

        expect(parentResult).toBeNull();
        expect(childResult).toBeNull();
        expect(requestedBookIds).toHaveLength(0);
        expect(accountLookups).toHaveLength(0);
        expect(requests).toHaveLength(0);
    });
});
