import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerAccountDeleted } from '../src/events/handlers/EventHandlerAccountDeleted';

interface CapturedRequest {
    method: string;
    url: string;
    account?: bkper.Account;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string): Book {
    return new Book({ id, name });
}

function buildEvent(): bkper.Event {
    return {
        data: {
            object: {
                id: 'parent-account',
                name: 'Child Account',
                type: AccountType.ASSET,
                groups: [{ id: 'linked-group', name: 'Assets' }],
            },
        },
    };
}

function createSetup(childAccount?: Account): {
    handler: EventHandlerAccountDeleted;
    parentBook: Book;
} {
    const parentBook = createBook('parent-book', 'Parent Book');
    const childBook = createBook('child-book', 'Child Book');
    const linkedParentGroup = new Group(parentBook, {
        id: 'linked-group',
        name: 'Assets',
        properties: { child_book_id: 'child-book' },
    });
    parentBook.getGroup = async id => (id === 'linked-group' ? linkedParentGroup : undefined);
    childBook.getAccount = async name => (name === 'Child Account' ? childAccount : undefined);
    const bkper = new Bkper();
    bkper.getBook = async () => childBook;

    return {
        handler: new EventHandlerAccountDeleted(new AppContext(bkper)),
        parentBook,
    };
}

function captureAccountRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];

    globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const account: bkper.Account | undefined =
                request.method === 'DELETE' ? undefined : await request.clone().json();
            requests.push({ method: request.method, url: request.url, account });
            return new Response(
                JSON.stringify(
                    account ?? {
                        id: 'child-account',
                        name: 'Child Account',
                        type: AccountType.ASSET,
                        hasTransactionPosted: true,
                    }
                ),
                { headers: { 'content-type': 'application/json' } }
            );
        },
        { preconnect: originalFetch.preconnect }
    );

    return requests;
}

describe('EventHandlerAccountDeleted legacy behavior', () => {
    test('returns the legacy not-found response without writing', async () => {
        const setup = createSetup();
        const requests = captureAccountRequests();

        const result = await setup.handler.processParentBookEvent(setup.parentBook, buildEvent());

        expect(result).toBe(
            "<a href='https://bkper.app/books/child-book/transactions'>Child Book</a>: CHILD ACCOUNT Child Account NOT Found"
        );
        expect(requests).toHaveLength(0);
    });

    test('deletes the child Account when legacy hasTransactionPosted is true', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const childAccount = new Account(childBook, {
            id: 'child-account',
            name: 'Child Account',
            type: AccountType.ASSET,
            hasTransactionPosted: true,
        });
        const setup = createSetup(childAccount);
        const requests = captureAccountRequests();

        const result = await setup.handler.processParentBookEvent(setup.parentBook, buildEvent());

        expect(result).toBe(
            "<a href='https://bkper.app/books/child-book/transactions'>Child Book</a>: CHILD ACCOUNT Child Account DELETED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('DELETE');
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/child-book/accounts/child-account?'
        );
        expect(requests[0].url).not.toContain('/transactions');
    });

    test('archives the child Account when legacy hasTransactionPosted is false', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const childAccount = new Account(childBook, {
            id: 'child-account',
            name: 'Child Account',
            type: AccountType.ASSET,
            hasTransactionPosted: false,
            archived: false,
        });
        const setup = createSetup(childAccount);
        const requests = captureAccountRequests();

        const result = await setup.handler.processParentBookEvent(setup.parentBook, buildEvent());

        expect(result).toBe(
            "<a href='https://bkper.app/books/child-book/transactions'>Child Book</a>: CHILD ACCOUNT Child Account ARCHIVED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/child-book/accounts?');
        expect(requests[0].account?.archived).toBe(true);
        expect(requests[0].url).not.toContain('/transactions');
    });
});
