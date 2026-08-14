import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerAccountCreatedOrUpdated } from '../../../src/events/handlers/EventHandlerAccountCreatedOrUpdated.js';

class TestEventHandlerAccountCreatedOrUpdated extends EventHandlerAccountCreatedOrUpdated {
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
    account: bkper.Account;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string, code: string): Book {
    return new Book({ id, name, properties: { exc_code: code } });
}

function createEvent(account: bkper.Account, previousName?: string): bkper.Event {
    return {
        data: {
            object: account,
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function captureAccountRequests(): CapturedRequest[] {
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const account: bkper.Account = await request.clone().json();
        requests.push({ method: request.method, url: request.url, account });
        return new Response(JSON.stringify({ id: account.id ?? 'connected-account', ...account }), {
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;
    return requests;
}

function createHandler(): TestEventHandlerAccountCreatedOrUpdated {
    return new TestEventHandlerAccountCreatedOrUpdated(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy Account create and update behavior', () => {
    test('creates a missing connected Account with synchronized fields', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        connectedBook.getAccount = async () => undefined;
        const requests = captureAccountRequests();
        const baseAccount: bkper.Account = {
            id: 'base-account',
            name: 'Revenue',
            type: AccountType.INCOMING,
            archived: true,
            groups: [{ id: 'base-group', name: 'Income' }],
            properties: { report: 'Sales', hidden_: 'do-not-copy' },
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent(baseAccount)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: ACCOUNT Revenue CREATED"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toContain('/v5/books/connected-book/accounts');
        expect(requests[0].url).not.toContain('/transactions');
        expect(requests[0].account).toMatchObject({
            name: 'Revenue',
            type: AccountType.INCOMING,
            archived: true,
            groups: [{ id: 'base-group', name: 'Income' }],
            properties: { report: 'Sales' },
        });
        expect(requests[0].account.properties?.hidden_).toBeUndefined();
    });

    test('finds a renamed connected Account and updates it', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const connectedAccount = new Account(connectedBook, {
            id: 'connected-account',
            name: 'Old Revenue',
            type: AccountType.OUTGOING,
            archived: true,
            properties: { stale: 'value' },
        });
        const lookups: (string | undefined)[] = [];
        connectedBook.getAccount = async name => {
            lookups.push(name);
            return name === 'Old Revenue' ? connectedAccount : undefined;
        };
        const requests = captureAccountRequests();
        const baseAccount: bkper.Account = {
            id: 'base-account',
            name: 'New Revenue',
            type: AccountType.INCOMING,
            archived: false,
            groups: [],
            properties: { report: 'Updated Sales' },
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent(baseAccount, 'Old Revenue')
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/connected-book/transactions'>Connected Book</a>: ACCOUNT New Revenue UPDATED"
        );
        expect(lookups).toEqual(['New Revenue', 'Old Revenue']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].account).toMatchObject({
            id: 'connected-account',
            name: 'New Revenue',
            type: AccountType.INCOMING,
            archived: false,
            properties: { report: 'Updated Sales' },
        });
        expect(requests[0].account.groups).toBeUndefined();
    });
});
