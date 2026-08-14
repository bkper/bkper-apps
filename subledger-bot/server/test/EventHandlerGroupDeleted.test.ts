import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerGroupDeleted } from '../src/events/handlers/EventHandlerGroupDeleted';

class TestEventHandlerGroupDeleted extends EventHandlerGroupDeleted {
    processChildEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processChildBookEvent(childBook, parentBook, event);
    }
}

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

function buildEvent(group: bkper.Group): bkper.Event {
    return {
        data: {
            object: group,
        },
    };
}

function captureResourceRequests(
    deleteResponse: bkper.Account | bkper.Group = {}
): CapturedRequest[] {
    const requests: CapturedRequest[] = [];

    globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const payload: bkper.Account | bkper.Group | undefined =
                request.method === 'DELETE' ? undefined : await request.clone().json();
            requests.push({ method: request.method, url: request.url, payload });
            return new Response(JSON.stringify(payload ?? deleteResponse), {
                headers: { 'content-type': 'application/json' },
            });
        },
        { preconnect: originalFetch.preconnect }
    );

    return requests;
}

function createHandler(bkper = new Bkper()): TestEventHandlerGroupDeleted {
    return new TestEventHandlerGroupDeleted(new AppContext(bkper));
}

function createParentGroupDeleteSetup(childGroup?: Group): {
    handler: EventHandlerGroupDeleted;
    parentBook: Book;
} {
    const parentBook = createBook('parent-book', 'Parent Book');
    const childBook = createBook('child-book', 'Child Book');
    childBook.getGroup = async name => (name === 'Revenue' ? childGroup : undefined);
    const bkper = new Bkper();
    bkper.getBook = async () => childBook;

    return {
        handler: createHandler(bkper),
        parentBook,
    };
}

function parentGroupDeleteEvent(): bkper.Event {
    return buildEvent({
        id: 'parent-group',
        name: 'Revenue',
        properties: { child_book_id: 'child-book' },
    });
}

describe('EventHandlerGroupDeleted legacy behavior', () => {
    test('returns the child Group not-found response without writing', async () => {
        const setup = createParentGroupDeleteSetup();
        const requests = captureResourceRequests();

        const result = await setup.handler.processParentBookEvent(
            setup.parentBook,
            parentGroupDeleteEvent()
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/child-book/transactions'>Child Book</a>: CHILD GROUP Revenue NOT Found"
        );
        expect(requests).toHaveLength(0);
    });

    test('deletes the connected child Group', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const childGroup = new Group(childBook, {
            id: 'child-group',
            name: 'Revenue',
        });
        const setup = createParentGroupDeleteSetup(childGroup);
        const requests = captureResourceRequests({ id: 'child-group', name: 'Revenue' });

        const result = await setup.handler.processParentBookEvent(
            setup.parentBook,
            parentGroupDeleteEvent()
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/child-book/transactions'>Child Book</a>: CHILD GROUP Revenue DELETED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('DELETE');
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/child-book/groups/child-group?'
        );
        expect(requests[0].url).not.toContain('/transactions');
    });

    test('returns the parent Account not-found response without writing', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        parentBook.getAccount = async () => undefined;
        const requests = captureResourceRequests();
        const childGroup: bkper.Group = {
            id: 'child-group',
            name: 'Services',
            properties: { parent_account: 'Mapped Parent' },
        };

        const result = await createHandler().processChildEvent(
            childBook,
            parentBook,
            buildEvent(childGroup)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: PARENT ACCOUNT Services NOT Found"
        );
        expect(requests).toHaveLength(0);
    });

    test('deletes the parent Account when legacy hasTransactionPosted is true', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const parentAccount = new Account(parentBook, {
            id: 'parent-account',
            name: 'Mapped Parent',
            type: AccountType.INCOMING,
            hasTransactionPosted: true,
        });
        parentBook.getAccount = async () => parentAccount;
        const requests = captureResourceRequests({
            id: 'parent-account',
            name: 'Mapped Parent',
            type: AccountType.INCOMING,
            hasTransactionPosted: true,
        });
        const childGroup: bkper.Group = {
            id: 'child-group',
            name: 'Services',
            properties: { parent_account: 'Mapped Parent' },
        };

        const result = await createHandler().processChildEvent(
            childBook,
            parentBook,
            buildEvent(childGroup)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: PARENT ACCOUNT Mapped Parent DELETED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('DELETE');
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/accounts/parent-account?'
        );
        expect(requests[0].url).not.toContain('/transactions');
    });

    test('archives the parent Account when legacy hasTransactionPosted is false', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const parentAccount = new Account(parentBook, {
            id: 'parent-account',
            name: 'Mapped Parent',
            type: AccountType.INCOMING,
            hasTransactionPosted: false,
            archived: false,
        });
        parentBook.getAccount = async () => parentAccount;
        const requests = captureResourceRequests();
        const childGroup: bkper.Group = {
            id: 'child-group',
            name: 'Services',
            properties: { parent_account: 'Mapped Parent' },
        };

        const result = await createHandler().processChildEvent(
            childBook,
            parentBook,
            buildEvent(childGroup)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: PARENT ACCOUNT Mapped Parent ARCHIVED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/parent-book/accounts?');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].payload).toMatchObject({
            id: 'parent-account',
            archived: true,
        });
    });
});
