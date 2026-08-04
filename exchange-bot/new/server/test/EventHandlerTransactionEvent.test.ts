import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, type Transaction } from 'bkper-js';
import { AppContext } from '../src/app-context.js';
import { EventHandlerTransactionEvent } from '../src/events/handlers/EventHandlerTransactionEvent.js';

class TestEventHandlerTransactionEvent extends EventHandlerTransactionEvent {
    mirror(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction
    ): Promise<Transaction | null> {
        return this.mirrorTransaction(baseBook, connectedBook, transaction);
    }
}

interface CapturedRequest {
    method: string;
    url: string;
    payload: Record<string, unknown>;
}

interface Fixture {
    baseBook: Book;
    connectedBook: Book;
    accounts: Map<string, Account>;
}

const originalFetch = globalThis.fetch;
const requests: CapturedRequest[] = [];
let failAccountCreates = false;
let generatedId = 0;

afterEach(() => {
    globalThis.fetch = originalFetch;
    requests.length = 0;
    failAccountCreates = false;
});

function createContext(): AppContext {
    return new AppContext(new Bkper(), {
        OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
        ASSETS: { fetch },
    });
}

function createBook(id: string, name: string, code: string): Book {
    return new Book({
        id,
        name,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties: {
            exc_code: code,
            exc_rates_url: `https://rates.test/transaction-event-${id}`,
        },
    });
}

function createAccount(book: Book, id: string, name: string): Account {
    return new Account(book, { id, name, type: AccountType.ASSET, groups: [], properties: {} });
}

function createFixture(): Fixture {
    const baseBook = createBook('base-book', 'Base Book', 'USD');
    const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
    const accounts = new Map<string, Account>([
        ['From', createAccount(connectedBook, 'connected-from', 'From')],
        ['To', createAccount(connectedBook, 'connected-to', 'To')],
    ]);

    connectedBook.getAccount = async name => accounts.get(name ?? '');
    connectedBook.getGroup = async () => undefined;

    return { baseBook, connectedBook, accounts };
}

function createTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'base-transaction',
        date: '2026-01-02',
        amount: '100',
        description: 'Payment',
        posted: true,
        checked: false,
        agentId: 'user',
        properties: { invoice: '42' },
        creditAccount: {
            id: 'base-from',
            name: 'From',
            type: AccountType.ASSET,
            groups: [],
            properties: {},
        },
        debitAccount: {
            id: 'base-to',
            name: 'To',
            type: AccountType.ASSET,
            groups: [],
            properties: {},
        },
        ...overrides,
    };
}

function installFetch(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);

        if (request.url.startsWith('https://rates.test/')) {
            return jsonResponse({ base: 'USD', rates: { EUR: '0.5' }, status: 200 });
        }

        const payload = request.body
            ? ((await request.clone().json()) as Record<string, unknown>)
            : {};
        requests.push({ method: request.method, url: request.url, payload });

        const path = new URL(request.url).pathname;
        if (failAccountCreates && request.method == 'POST' && path.endsWith('/accounts')) {
            return new Response(JSON.stringify({ error: 'account create failed' }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (path.endsWith('/groups')) {
            return jsonResponse({ group: { ...payload, id: `group-${++generatedId}` } });
        }
        if (path.endsWith('/accounts')) {
            return jsonResponse({ account: { ...payload, id: `account-${++generatedId}` } });
        }

        return jsonResponse({
            transaction: {
                ...payload,
                id: `transaction-${++generatedId}`,
                posted: path.endsWith('/post') ? true : payload.posted,
            },
        });
    }) as unknown as typeof fetch;
}

function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
    });
}

function transactionRequests(): CapturedRequest[] {
    return requests.filter(request => new URL(request.url).pathname.includes('/transactions'));
}

function createHandler(): TestEventHandlerTransactionEvent {
    return new TestEventHandlerTransactionEvent(createContext());
}

describe('legacy shared transaction mirroring', () => {
    test('keeps an unresolved mirror as a non-posted draft', async () => {
        installFetch();
        failAccountCreates = true;
        const fixture = createFixture();
        fixture.accounts.delete('From');

        await createHandler().mirror(fixture.baseBook, fixture.connectedBook, createTransaction());

        expect(transactionRequests()).toHaveLength(1);
        expect(transactionRequests()[0].method).toBe('POST');
        expect(transactionRequests()[0].url).toContain('/transactions?');
        expect(transactionRequests()[0].payload).toMatchObject({
            amount: '50',
            description: 'Payment',
            debitAccount: { id: 'connected-to' },
        });
        expect(transactionRequests()[0].payload.creditAccount).toBeUndefined();
        expect(transactionRequests()[0].payload.posted).not.toBe(true);
    });

    test('creates a missing Group and Account before posting the mirror', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.accounts.delete('From');
        let fromLookups = 0;
        const createdFrom = createAccount(fixture.connectedBook, 'created-from', 'From');
        fixture.connectedBook.getAccount = async name => {
            if (name == 'From') {
                fromLookups += 1;
                return fromLookups == 1 ? undefined : createdFrom;
            }
            return fixture.accounts.get(name ?? '');
        };
        const transaction = createTransaction({
            creditAccount: {
                id: 'base-from',
                name: 'From',
                type: AccountType.INCOMING,
                groups: [{ name: 'Revenue', properties: { report: 'income' } }],
                properties: { source: 'base' },
            },
        });

        await createHandler().mirror(fixture.baseBook, fixture.connectedBook, transaction);

        expect(requests.map(request => new URL(request.url).pathname)).toEqual([
            '/v5/books/connected-book/groups',
            '/v5/books/connected-book/accounts',
            '/v5/books/connected-book/transactions/post',
        ]);
        expect(requests[0].payload).toMatchObject({
            name: 'Revenue',
            properties: { report: 'income' },
        });
        expect(requests[1].payload).toMatchObject({
            name: 'From',
            type: AccountType.INCOMING,
            properties: { source: 'base' },
            groups: [{ group: { name: 'Revenue' } }],
        });
    });

    test('does not create a movement for a converted zero amount', async () => {
        installFetch();
        const fixture = createFixture();

        const result = await createHandler().mirror(
            fixture.baseBook,
            fixture.connectedBook,
            createTransaction({ properties: { exc_amount: '0', exc_code: 'EUR' } })
        );

        expect(result).toBeNull();
        expect(transactionRequests()).toHaveLength(0);
    });
});
