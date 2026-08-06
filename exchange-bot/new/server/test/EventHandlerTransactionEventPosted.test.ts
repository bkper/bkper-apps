import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../src/shared/app-context.js';
import { EventHandlerTransactionPosted } from '../src/events/handlers/EventHandlerTransactionEventPosted.js';

class TestEventHandlerTransactionPosted extends EventHandlerTransactionPosted {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }
}

interface CapturedRequest {
    url: string;
    payload: Record<string, unknown>;
}

interface Fixture {
    baseBook: Book;
    connectedBook: Book;
    accounts: Map<string, Account>;
    queries: string[];
    setConnectedTransaction(transaction?: bkper.Transaction): void;
}

const originalFetch = globalThis.fetch;
const requests: CapturedRequest[] = [];

afterEach(() => {
    globalThis.fetch = originalFetch;
    requests.length = 0;
});

function createContext(): AppContext {
    return new AppContext(new Bkper(), {
        OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
        ASSETS: { fetch },
    });
}

function createBook(id: string, name: string, code: string, extra: Partial<bkper.Book> = {}): Book {
    return new Book({
        id,
        name,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties: {
            exc_code: code,
            exc_rates_url: `https://rates.test/transaction-posted-${id}`,
        },
        ...extra,
    });
}

function createAccount(book: Book, id: string, name: string): Account {
    return new Account(book, { id, name, type: AccountType.ASSET, groups: [], properties: {} });
}

function createFixture(): Fixture {
    const baseBook = createBook('base-book', 'Base Book', 'USD', {
        collection: {
            books: [
                { id: 'gbp-book', properties: { exc_code: 'GBP' } },
                { id: 'brl-book', properties: { exc_code: 'BRL' } },
            ],
        },
    });
    const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
    const accounts = new Map<string, Account>([
        ['From', createAccount(connectedBook, 'connected-from', 'From')],
        ['To', createAccount(connectedBook, 'connected-to', 'To')],
    ]);
    const queries: string[] = [];
    let connectedTransaction: bkper.Transaction | undefined;

    connectedBook.getAccount = async name => accounts.get(name ?? '');
    connectedBook.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(connectedBook, {
            items: connectedTransaction ? [connectedTransaction] : [],
        });
    };

    return {
        baseBook,
        connectedBook,
        accounts,
        queries,
        setConnectedTransaction(transaction?: bkper.Transaction): void {
            connectedTransaction = transaction;
        },
    };
}

function createTransaction(): bkper.Transaction {
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
            groups: [{ name: 'GBP', properties: {} }],
            properties: {},
        },
        debitAccount: {
            id: 'base-to',
            name: 'To',
            type: AccountType.ASSET,
            groups: [{ name: 'BRL', properties: {} }],
            properties: {},
        },
    };
}

function createEvent(transaction: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_POSTED',
        data: { object: { transaction } },
    };
}

function createConnectedTransaction(fixture: Fixture): bkper.Transaction {
    return {
        id: 'connected-transaction',
        date: '2026-01-02',
        dateFormatted: '2026-01-02',
        amount: '50',
        description: 'Payment',
        posted: true,
        checked: false,
        properties: {},
        creditAccount: fixture.accounts.get('From')!.json(),
        debitAccount: fixture.accounts.get('To')!.json(),
        remoteIds: ['base-transaction'],
    };
}

function installFetch(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);

        if (request.url.startsWith('https://rates.test/')) {
            return jsonResponse({
                base: 'USD',
                rates: { EUR: '0.5', GBP: '0.8', BRL: '5' },
                status: 200,
            });
        }

        const payload = request.body
            ? ((await request.clone().json()) as Record<string, unknown>)
            : {};
        requests.push({ url: request.url, payload });
        return jsonResponse({
            transaction: {
                ...payload,
                id: 'connected-transaction',
                posted: request.url.includes('/transactions/post'),
            },
        });
    }) as unknown as typeof fetch;
}

function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
    });
}

function createHandler(): TestEventHandlerTransactionPosted {
    return new TestEventHandlerTransactionPosted(createContext());
}

describe('legacy posted transaction behavior', () => {
    test('posts one complete mirrored movement with trace properties', async () => {
        installFetch();
        const fixture = createFixture();

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: 2026-01-02 50 Payment"
        );
        expect(fixture.queries).toEqual(['remoteId:base-transaction']);
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toContain('/transactions/post?');
        expect(requests[0].payload).toMatchObject({
            date: '2026-01-02',
            amount: '50',
            description: 'Payment',
            creditAccount: { id: 'connected-from', name: 'From' },
            debitAccount: { id: 'connected-to', name: 'To' },
            remoteIds: ['base-transaction'],
            checked: false,
            properties: {
                invoice: '42',
                exc_code: 'USD',
                exc_rate: '0.5',
                exc_amount: '100',
                exc_log:
                    '[{"exc_code":"GBP","exc_rate":"0.5"},{"exc_code":"BRL","exc_rate":"0.1"}]',
            },
        });
    });

    test('uses an existing remote-id match instead of creating a duplicate', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(createConnectedTransaction(fixture));

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBeNull();
        expect(fixture.queries).toEqual(['remoteId:base-transaction']);
        expect(requests).toHaveLength(0);
    });
});
