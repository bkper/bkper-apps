import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerTransactionRestored } from '../../../src/events/handlers/EventHandlerTransactionRestored.js';

class TestEventHandlerTransactionRestored extends EventHandlerTransactionRestored {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }
}

interface Fixture {
    baseBook: Book;
    connectedBook: Book;
    queries: string[];
}

const originalFetch = globalThis.fetch;
const requests: Request[] = [];

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
        ['connected-from', connectedFrom],
        ['connected-to', connectedTo],
    ]);
    const connectedTransaction: bkper.Transaction = {
        id: 'connected-transaction',
        date: '2025-12-31',
        dateFormatted: '2025-12-31',
        amount: '40',
        description: 'Original payment',
        posted: true,
        checked: false,
        trashed: true,
        properties: {},
        creditAccount: connectedFrom.json(),
        debitAccount: connectedTo.json(),
        remoteIds: ['base-transaction'],
    };
    const queries: string[] = [];

    connectedBook.getAccount = async id => connectedAccounts.get(id ?? '');
    connectedBook.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(connectedBook, { items: [connectedTransaction] });
    };

    return { baseBook, connectedBook, queries };
}

function createEvent(): bkper.Event {
    return {
        type: 'TRANSACTION_RESTORED',
        data: {
            object: {
                transaction: {
                    id: 'base-transaction',
                    posted: true,
                    checked: false,
                    agentId: 'user',
                    properties: {},
                    creditAccount: { id: 'base-from', name: 'From' },
                    debitAccount: { id: 'base-to', name: 'To' },
                },
            },
        },
    };
}

function installFetch(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        const transaction: bkper.Transaction = await request.clone().json();
        return new Response(JSON.stringify({ transaction: { ...transaction, trashed: false } }), {
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;
}

function createHandler(): TestEventHandlerTransactionRestored {
    return new TestEventHandlerTransactionRestored(createContext());
}

describe('legacy restored transaction behavior', () => {
    test('finds a trashed mirror and restores it', async () => {
        installFetch();
        const fixture = createFixture();

        const result = await createHandler().processConnectedBook(
            fixture.baseBook,
            fixture.connectedBook,
            createEvent()
        );

        expect(fixture.queries).toEqual(['remoteId:base-transaction is:trashed']);
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=connected-book'>Connected Book</a>: RESTORED: 2025-12-31 40.00 Original payment"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toContain('/v5/books/connected-book/transactions/restore');
    });
});
