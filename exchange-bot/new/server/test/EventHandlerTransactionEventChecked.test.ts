import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../src/shared/app-context.js';
import { EventHandlerTransactionChecked } from '../src/events/handlers/EventHandlerTransactionEventChecked.js';

class TestEventHandlerTransactionChecked extends EventHandlerTransactionChecked {
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

function createBook(id: string, name: string, code: string): Book {
    return new Book({
        id,
        name,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties: {
            exc_code: code,
            exc_rates_url: `https://rates.test/transaction-checked-${id}`,
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
    let connectedTransaction: bkper.Transaction | undefined;

    connectedBook.getAccount = async name => accounts.get(name ?? '');
    connectedBook.listTransactions = async () =>
        new TransactionList(connectedBook, {
            items: connectedTransaction ? [connectedTransaction] : [],
        });

    return {
        baseBook,
        connectedBook,
        accounts,
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
        checked: true,
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
    };
}

function createEvent(transaction: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_CHECKED',
        data: { object: { transaction } },
    };
}

function createConnectedTransaction(
    fixture: Fixture,
    overrides: Partial<bkper.Transaction> = {}
): bkper.Transaction {
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
                id: (payload.id as string | undefined) ?? 'connected-transaction',
                posted: path.endsWith('/post') ? true : payload.posted,
                checked: path.endsWith('/check')
                    ? true
                    : path.endsWith('/uncheck')
                      ? false
                      : payload.checked,
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

function createHandler(): TestEventHandlerTransactionChecked {
    return new TestEventHandlerTransactionChecked(createContext());
}

describe('legacy checked transaction behavior', () => {
    test('checks an existing posted and unchecked mirror', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(createConnectedTransaction(fixture));

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: CHECKED: 2026-01-02 50.00 Payment"
        );
        expect(transactionRequests().map(request => new URL(request.url).pathname)).toEqual([
            '/v5/books/connected-book/transactions/check',
        ]);
    });

    test('unchecks then updates a checked mirror when the amount changes', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(
            createConnectedTransaction(fixture, { amount: '40', checked: true })
        );

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: UPDATED AND CHECKED: 2026-01-02 50.00 Payment"
        );
        expect(transactionRequests().map(request => new URL(request.url).pathname)).toEqual([
            '/v5/books/connected-book/transactions/uncheck',
            '/v5/books/connected-book/transactions',
        ]);
        expect(transactionRequests()[1].payload).toMatchObject({
            amount: '50',
            checked: true,
            properties: { exc_rate: '0.5' },
        });
    });

    test('posts a complete existing draft as checked', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(
            createConnectedTransaction(fixture, { posted: false, checked: false })
        );

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: POSTED AND CHECKED: 2026-01-02 50.00 Payment"
        );
        expect(transactionRequests().map(request => new URL(request.url).pathname)).toEqual([
            '/v5/books/connected-book/transactions/post',
        ]);
        expect(transactionRequests()[0].payload.checked).toBe(true);
    });

    test('returns the legacy response when the existing mirror is already checked', async () => {
        installFetch();
        const fixture = createFixture();
        fixture.setConnectedTransaction(
            createConnectedTransaction(fixture, { posted: true, checked: true })
        );

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: ALREADY CHECKED: 2026-01-02 50.00 Payment"
        );
        expect(transactionRequests()).toHaveLength(0);
    });

    test('posts a new complete checked mirror as one movement', async () => {
        installFetch();
        const fixture = createFixture();

        await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent(createTransaction())
        );

        expect(transactionRequests()).toHaveLength(1);
        expect(transactionRequests()[0].url).toContain('/transactions/post?');
        expect(transactionRequests()[0].payload).toMatchObject({
            amount: '50',
            checked: true,
            creditAccount: { id: 'connected-from' },
            debitAccount: { id: 'connected-to' },
        });
    });
});
