import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerAccountCreatedOrUpdated } from '../src/events/handlers/EventHandlerAccountCreatedOrUpdated';

interface CapturedRequest {
    method: string;
    url: string;
    account: bkper.Account;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string): Book {
    return new Book({ id, name });
}

function buildEvent(account: bkper.Account, previousName?: string): bkper.Event {
    return {
        data: {
            object: account,
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function captureAccountRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];

    globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const account: bkper.Account = await request.clone().json();
            requests.push({ method: request.method, url: request.url, account });
            return new Response(JSON.stringify({ id: account.id ?? 'child-account', ...account }), {
                headers: { 'content-type': 'application/json' },
            });
        },
        { preconnect: originalFetch.preconnect }
    );

    return requests;
}

function createSetup(): {
    handler: EventHandlerAccountCreatedOrUpdated;
    parentBook: Book;
    childBook: Book;
    childGroup: Group;
    requestedBookIds: string[];
} {
    const parentBook = createBook('parent-book', 'Parent Book');
    const childBook = createBook('child-book', 'Child Book');
    const unrelatedParentGroup = new Group(parentBook, {
        id: 'unrelated-group',
        name: 'Unrelated',
    });
    const linkedParentGroup = new Group(parentBook, {
        id: 'linked-group',
        name: 'Revenue',
        properties: { child_book_id: 'child-book' },
    });
    const otherLinkedParentGroup = new Group(parentBook, {
        id: 'other-linked-group',
        name: 'Other Revenue',
        properties: { child_book_id: 'other-child-book' },
    });
    const childGroup = new Group(childBook, {
        id: 'child-group',
        name: 'Revenue',
    });
    parentBook.getGroup = async id => {
        if (id === 'unrelated-group') {
            return unrelatedParentGroup;
        }
        if (id === 'linked-group') {
            return linkedParentGroup;
        }
        if (id === 'other-linked-group') {
            return otherLinkedParentGroup;
        }
        return undefined;
    };
    childBook.getGroup = async name => (name === 'Revenue' ? childGroup : undefined);
    const requestedBookIds: string[] = [];
    const bkper = new Bkper();
    bkper.getBook = async id => {
        requestedBookIds.push(id);
        return childBook;
    };

    return {
        handler: new EventHandlerAccountCreatedOrUpdated(new AppContext(bkper)),
        parentBook,
        childBook,
        childGroup,
        requestedBookIds,
    };
}

describe('EventHandlerAccountCreatedOrUpdated legacy behavior', () => {
    test('creates a child Account in the first linked child Book', async () => {
        const setup = createSetup();
        setup.childBook.getAccount = async () => undefined;
        const requests = captureAccountRequests();
        const parentAccount: bkper.Account = {
            id: 'parent-account',
            name: 'Service Revenue',
            type: AccountType.INCOMING,
            archived: true,
            properties: { invoice: '1042', hidden_: 'do-not-copy' },
            groups: [
                { id: 'unrelated-group', name: 'Unrelated' },
                { id: 'linked-group', name: 'Revenue' },
                { id: 'other-linked-group', name: 'Other Revenue' },
            ],
        };

        const result = await setup.handler.processParentBookEvent(
            setup.parentBook,
            buildEvent(parentAccount)
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=child-book'>Child Book</a>: CHILD ACCOUNT Service Revenue CREATED"
        );
        expect(setup.requestedBookIds).toEqual(['child-book']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/child-book/accounts?');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].account).toMatchObject({
            name: 'Service Revenue',
            type: AccountType.INCOMING,
            archived: true,
            properties: { invoice: '1042' },
            groups: [{ id: 'child-group', name: 'Revenue' }],
        });
        expect(requests[0].account.properties?.hidden_).toBeUndefined();
    });

    test('finds a renamed child Account by its previous name and updates it', async () => {
        const setup = createSetup();
        const existingChildAccount = new Account(setup.childBook, {
            id: 'child-account',
            name: 'Old Name',
            type: AccountType.OUTGOING,
            archived: true,
        });
        const accountLookups: (string | undefined)[] = [];
        setup.childBook.getAccount = async name => {
            accountLookups.push(name);
            return name === 'Old Name' ? existingChildAccount : undefined;
        };
        const requests = captureAccountRequests();
        const parentAccount: bkper.Account = {
            id: 'parent-account',
            name: 'New Name',
            type: AccountType.INCOMING,
            archived: false,
            properties: { source: 'parent' },
            groups: [{ id: 'linked-group', name: 'Revenue' }],
        };

        const result = await setup.handler.processParentBookEvent(
            setup.parentBook,
            buildEvent(parentAccount, 'Old Name')
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=child-book'>Child Book</a>: CHILD ACCOUNT New Name UPDATED"
        );
        expect(accountLookups).toEqual(['New Name', 'Old Name']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].account).toMatchObject({
            id: 'child-account',
            name: 'New Name',
            type: AccountType.INCOMING,
            archived: false,
            properties: { source: 'parent' },
            groups: [{ id: 'child-group', name: 'Revenue' }],
        });
    });

    test('does nothing when the parent Account has no linked child Book', async () => {
        const setup = createSetup();
        const requests = captureAccountRequests();

        const result = await setup.handler.processParentBookEvent(
            setup.parentBook,
            buildEvent({ id: 'parent-account', name: 'Unlinked Account', groups: [] })
        );

        expect(result).toBeNull();
        expect(setup.requestedBookIds).toHaveLength(0);
        expect(requests).toHaveLength(0);
    });

    test('keeps child-side Account events as no-ops', async () => {
        const setup = createSetup();
        const requests = captureAccountRequests();

        const result = await setup.handler.processChildBookEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent({ id: 'child-account', name: 'Child Account' })
        );

        expect(result).toBeNull();
        expect(setup.requestedBookIds).toHaveLength(0);
        expect(requests).toHaveLength(0);
    });
});
