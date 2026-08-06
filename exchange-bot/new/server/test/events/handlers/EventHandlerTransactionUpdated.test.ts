import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerTransactionUpdated } from '../../../src/events/handlers/EventHandlerTransactionUpdated.js';

class TestEventHandlerTransactionUpdated extends EventHandlerTransactionUpdated {
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
    connectedAccounts: Map<string, Account>;
    queries: string[];
    setConnectedTransaction(transaction?: bkper.Transaction): void;
}

const originalFetch = globalThis.fetch;
const requests: CapturedRequest[] = [];
let fixtureSequence = 0;

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

function createBook(id: string, name: string, code: string, ratesKey: number): Book {
    return new Book({
        id,
        name,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties: {
            exc_code: code,
            exc_rates_url: `https://rates.test/transaction-updated-${ratesKey}-${id}`,
        },
    });
}

function createAccount(book: Book, id: string, name: string): Account {
    return new Account(book, { id, name, type: AccountType.ASSET, groups: [], properties: {} });
}

function createFixture(): Fixture {
    fixtureSequence += 1;
    const baseBook = createBook('base-book', 'Base Book', 'USD', fixtureSequence);
    const connectedBook = createBook('connected-book', 'Connected Book', 'EUR', fixtureSequence);
    const baseAccounts = new Map<string, Account>([
        ['base-from', createAccount(baseBook, 'base-from', 'From')],
        ['base-to', createAccount(baseBook, 'base-to', 'To')],
    ]);
    const connectedFrom = createAccount(connectedBook, 'connected-from', 'From');
    const connectedTo = createAccount(connectedBook, 'connected-to', 'To');
    const connectedAccounts = new Map<string, Account>([
        ['From', connectedFrom],
        ['connected-from', connectedFrom],
        ['To', connectedTo],
        ['connected-to', connectedTo],
    ]);
    const queries: string[] = [];
    let connectedTransaction: bkper.Transaction | undefined;

    baseBook.getAccount = async id => baseAccounts.get(id ?? '');
    connectedBook.getAccount = async name => connectedAccounts.get(name ?? '');
    connectedBook.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(connectedBook, {
            items: connectedTransaction ? [connectedTransaction] : [],
        });
    };

    return {
        baseBook,
        connectedBook,
        connectedAccounts,
        queries,
        setConnectedTransaction(transaction?: bkper.Transaction): void {
            connectedTransaction = transaction;
        },
    };
}

function createTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'base-transaction',
        date: '2026-01-02',
        amount: '100',
        description: 'Updated payment',
        posted: true,
        checked: true,
        agentId: 'user',
        properties: { invoice: '42' },
        urls: ['https://example.test/source'],
        files: [{ url: 'https://example.test/file' }],
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

function createEvent(transaction: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_UPDATED',
        data: { object: { transaction } },
    };
}

function createConnectedTransaction(
    fixture: Fixture,
    overrides: Partial<bkper.Transaction> = {}
): bkper.Transaction {
    return {
        id: 'connected-transaction',
        date: '2025-12-31',
        dateFormatted: '2025-12-31',
        amount: '40',
        description: 'Original payment',
        posted: true,
        checked: true,
        trashed: false,
        properties: { stale: 'value' },
        urls: ['https://example.test/old'],
        creditAccount: fixture.connectedAccounts.get('From')!.json(),
        debitAccount: fixture.connectedAccounts.get('To')!.json(),
        remoteIds: ['base-transaction'],
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
        requests.push({ url: request.url, payload });
        const path = new URL(request.url).pathname;
        return jsonResponse({
            transaction: {
                ...payload,
                dateFormatted: payload.date,
                checked: path.endsWith('/uncheck') ? false : payload.checked,
                trashed: path.endsWith('/trash') ? true : payload.trashed,
            },
        });
    }) as unknown as typeof fetch;
}

function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
    });
}

function transactionPaths(): string[] {
    return requests.map(request => new URL(request.url).pathname);
}

function createHandler(): TestEventHandlerTransactionUpdated {
    return new TestEventHandlerTransactionUpdated(createContext());
}

describe('legacy updated transaction behavior', () => {
    test('unchecks then updates an existing mirror with the complete movement and metadata', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(createConnectedTransaction(fixture));

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: EDITED: 2026-01-02 50.00  From To Updated payment"
        );
        expect(fixture.queries).toEqual(['remoteId:base-transaction']);
        expect(transactionPaths()).toEqual([
            '/v5/books/connected-book/transactions/uncheck',
            '/v5/books/connected-book/transactions',
        ]);
        expect(requests[1].payload).toMatchObject({
            date: '2026-01-02',
            amount: '50',
            description: 'Updated payment',
            checked: true,
            creditAccount: { id: 'connected-from', name: 'From' },
            debitAccount: { id: 'connected-to', name: 'To' },
            urls: ['https://example.test/source', 'https://example.test/file'],
            properties: {
                invoice: '42',
                exc_code: 'USD',
                exc_rate: '0.5',
                exc_amount: '100',
            },
        });
    });

    test('unchecks and trashes a checked mirror when recalculation reaches zero', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(createConnectedTransaction(fixture));

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction({ properties: { exc_amount: '0', exc_code: 'EUR' } }))
        );

        expect(result).toBe('DELETED: 2025-12-31 40.00 From To Original payment');
        expect(transactionPaths()).toEqual([
            '/v5/books/connected-book/transactions/uncheck',
            '/v5/books/connected-book/transactions/trash',
        ]);
    });

    test('mirrors an updated posted transaction when its remote-id match is absent', async () => {
        installFetch();
        const fixture = createFixture();

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction({ checked: false }))
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: 2026-01-02 50 Updated payment"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toContain('/transactions/post?');
        expect(requests[0].payload).toMatchObject({
            amount: '50',
            creditAccount: { id: 'connected-from' },
            debitAccount: { id: 'connected-to' },
        });
    });
});
