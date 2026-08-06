import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../src/shared/app-context.js';
import { EventHandlerTransactionDeleted } from '../src/events/handlers/EventHandlerTransactionDeleted.js';

class TestEventHandlerTransactionDeleted extends EventHandlerTransactionDeleted {
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
    fallbackIds: string[];
    setConnectedTransaction(transaction?: bkper.Transaction): void;
    setFallbackTransaction(transaction?: Transaction): void;
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

function createBook(id: string, name: string, code: string): Book {
    return new Book({
        id,
        name,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties: { exc_code: code },
    });
}

function createAccount(book: Book, id: string, name: string): Account {
    return new Account(book, { id, name, type: AccountType.ASSET, groups: [], properties: {} });
}

function createFixture(): Fixture {
    const baseBook = createBook('base-book', 'Base Book', 'USD');
    const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
    const connectedFrom = createAccount(connectedBook, 'connected-from', 'From');
    const connectedTo = createAccount(connectedBook, 'connected-to', 'To');
    const connectedAccounts = new Map<string, Account>([
        ['From', connectedFrom],
        ['connected-from', connectedFrom],
        ['To', connectedTo],
        ['connected-to', connectedTo],
    ]);
    const queries: string[] = [];
    const fallbackIds: string[] = [];
    let connectedTransaction: bkper.Transaction | undefined;
    let fallbackTransaction: Transaction | undefined;

    connectedBook.getAccount = async name => connectedAccounts.get(name ?? '');
    connectedBook.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(connectedBook, {
            items: connectedTransaction ? [connectedTransaction] : [],
        });
    };
    connectedBook.getTransaction = async id => {
        fallbackIds.push(id);
        return fallbackTransaction;
    };

    return {
        baseBook,
        connectedBook,
        connectedAccounts,
        queries,
        fallbackIds,
        setConnectedTransaction(transaction?: bkper.Transaction): void {
            connectedTransaction = transaction;
        },
        setFallbackTransaction(transaction?: Transaction): void {
            fallbackTransaction = transaction;
        },
    };
}

function createTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'base-transaction',
        posted: true,
        checked: true,
        agentId: 'user',
        properties: {},
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
        type: 'TRANSACTION_DELETED',
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
        properties: {},
        creditAccount: fixture.connectedAccounts.get('From')!.json(),
        debitAccount: fixture.connectedAccounts.get('To')!.json(),
        remoteIds: ['base-transaction'],
        ...overrides,
    };
}

function installFetch(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const payload = request.body
            ? ((await request.clone().json()) as Record<string, unknown>)
            : {};
        requests.push({ url: request.url, payload });
        const path = new URL(request.url).pathname;
        return new Response(
            JSON.stringify({
                transaction: {
                    ...payload,
                    checked: path.endsWith('/uncheck') ? false : payload.checked,
                    trashed: path.endsWith('/trash') ? true : payload.trashed,
                },
            }),
            { headers: { 'content-type': 'application/json' } }
        );
    }) as unknown as typeof fetch;
}

function transactionPaths(): string[] {
    return requests.map(request => new URL(request.url).pathname);
}

function createHandler(): TestEventHandlerTransactionDeleted {
    return new TestEventHandlerTransactionDeleted(createContext());
}

describe('legacy deleted transaction behavior', () => {
    test('unchecks then trashes an existing mirror', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(createConnectedTransaction(fixture));

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: DELETED: 2025-12-31 40.00 Original payment"
        );
        expect(transactionPaths()).toEqual([
            '/v5/books/connected-book/transactions/uncheck',
            '/v5/books/connected-book/transactions/trash',
        ]);
    });

    test('falls back to source remote ids after the remote-id query misses', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setFallbackTransaction(
            new Transaction(
                fixture.connectedBook,
                createConnectedTransaction(fixture, { checked: false })
            )
        );

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction({ remoteIds: ['connected-transaction'] }))
        );

        expect(fixture.queries).toEqual(['remoteId:base-transaction']);
        expect(fixture.fallbackIds).toEqual(['connected-transaction']);
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=base-book'>Base Book</a>: DELETED: 2025-12-31 40.00 Original payment"
        );
        expect(transactionPaths()).toEqual(['/v5/books/connected-book/transactions/trash']);
    });
});
