import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerAccountDeleted } from '../../../src/events/handlers/EventHandlerAccountDeleted.js';

class TestEventHandlerAccountDeleted extends EventHandlerAccountDeleted {
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
    account?: bkper.Account;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string, code: string): Book {
    return new Book({ id, name, properties: { exc_code: code } });
}

function createEvent(): bkper.Event {
    return { data: { object: { id: 'base-account', name: 'Revenue' } } };
}

function captureAccountRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const account: bkper.Account | undefined =
            request.method === 'DELETE' ? undefined : await request.clone().json();
        requests.push({ method: request.method, url: request.url, account });
        return new Response(
            JSON.stringify(
                account ?? {
                    id: 'connected-account',
                    name: 'Revenue',
                    type: AccountType.INCOMING,
                }
            ),
            { headers: { 'content-type': 'application/json' } }
        );
    }) as unknown as typeof fetch;
    return requests;
}

function createHandler(): TestEventHandlerAccountDeleted {
    return new TestEventHandlerAccountDeleted(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy Account deletion behavior', () => {
    test('returns the established not-found response without writing', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        connectedBook.getAccount = async () => undefined;
        const requests = captureAccountRequests();

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent()
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: ACCOUNT Revenue NOT Found"
        );
        expect(requests).toHaveLength(0);
    });

    test('archives a connected Account that has posted transactions', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const connectedAccount = new Account(connectedBook, {
            id: 'connected-account',
            name: 'Revenue',
            type: AccountType.INCOMING,
            hasTransactionPosted: true,
            archived: false,
        });
        connectedBook.getAccount = async () => connectedAccount;
        const requests = captureAccountRequests();

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent()
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: ACCOUNT Revenue DELETED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].account?.archived).toBe(true);
        expect(requests[0].url).not.toContain('/transactions');
    });

    test('removes a connected Account without posted transactions', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const connectedAccount = new Account(connectedBook, {
            id: 'connected-account',
            name: 'Revenue',
            type: AccountType.INCOMING,
            hasTransactionPosted: false,
        });
        connectedBook.getAccount = async () => connectedAccount;
        const requests = captureAccountRequests();

        await createHandler().processConnectedBook(baseBook, connectedBook, createEvent());

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('DELETE');
        expect(requests[0].url).toContain('/v5/books/connected-book/accounts/connected-account');
        expect(requests[0].url).not.toContain('/transactions');
    });
});
