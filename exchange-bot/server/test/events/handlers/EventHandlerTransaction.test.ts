import { afterEach, describe, expect, test } from 'bun:test';
import { AccountType, Bkper, Book, type Transaction } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerTransaction } from '../../../src/events/handlers/EventHandlerTransaction.js';

class TestEventHandlerTransaction extends EventHandlerTransaction {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return '';
    }

    protected connectedTransactionNotFound(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction
    ): null {
        return null;
    }

    protected async connectedTransactionFound(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction,
        connectedTransaction: Transaction
    ): Promise<null> {
        return null;
    }
}

const originalFetch = globalThis.fetch;
let requests = 0;

afterEach(() => {
    globalThis.fetch = originalFetch;
    requests = 0;
});

function blockNetwork(): void {
    globalThis.fetch = (async () => {
        requests += 1;
        throw new Error('A skipped transaction must not reach the network');
    }) as unknown as typeof fetch;
}

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
        properties: { exc_code: code },
        ...extra,
    });
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
        type: 'TRANSACTION_POSTED',
        data: { object: { transaction } },
    };
}

describe('legacy shared transaction behavior', () => {
    test('does not mirror an ineligible transaction when the collection has a base Book', async () => {
        blockNetwork();
        const baseBook = createBook('base-book', 'Base Book', 'USD', {
            collection: {
                books: [
                    {
                        id: 'base-book',
                        properties: { exc_code: 'USD', exc_base: 'true' },
                    },
                    { id: 'connected-book', properties: { exc_code: 'EUR' } },
                ],
            },
        });
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        let queries = 0;
        connectedBook.listTransactions = async () => {
            queries += 1;
            throw new Error('An ineligible transaction must not be queried');
        };

        const result = await new TestEventHandlerTransaction(createContext()).processConnectedBook(
            baseBook,
            connectedBook,
            createEvent(createTransaction())
        );

        expect(result).toBeNull();
        expect(queries).toBe(0);
        expect(requests).toBe(0);
    });

    test('preserves unposted and same-agent no-op branches', async () => {
        blockNetwork();
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        let queries = 0;
        connectedBook.listTransactions = async () => {
            queries += 1;
            throw new Error('A skipped transaction must not be queried');
        };
        const handler = new TestEventHandlerTransaction(createContext());

        for (const transaction of [
            createTransaction({ posted: false }),
            createTransaction({ agentId: 'exchange-bot' }),
        ]) {
            const result = await handler.processConnectedBook(
                baseBook,
                connectedBook,
                createEvent(transaction)
            );
            expect(result).toBeNull();
        }

        expect(queries).toBe(0);
        expect(requests).toBe(0);
    });
});
