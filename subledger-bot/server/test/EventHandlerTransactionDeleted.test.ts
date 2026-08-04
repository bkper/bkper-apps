import { afterEach, describe, expect, test } from 'bun:test';
import { Account, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerTransactionDeleted } from '../src/events/handlers/EventHandlerTransactionDeleted';

class TestEventHandlerTransactionDeleted extends EventHandlerTransactionDeleted {
    processChildEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processChildBookEvent(childBook, parentBook, event);
    }
}

interface CapturedRequest {
    url: string;
    transaction: bkper.Transaction;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createBook(id: string, name: string): Book {
    return new Book({
        id,
        name,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
    });
}

function buildEvent(): bkper.Event {
    return {
        data: {
            object: {
                transaction: {
                    id: 'child-transaction',
                    posted: true,
                    properties: {},
                },
            },
        },
    };
}

function buildConnectedTransaction(checked = true): bkper.Transaction {
    return {
        id: 'parent-transaction',
        date: '2026-07-30',
        dateFormatted: '2026-07-30',
        amount: '125.50',
        description: 'Invoice #1042',
        posted: true,
        checked,
        creditAccount: { id: 'parent-credit', name: 'Parent From' },
        debitAccount: { id: 'parent-debit', name: 'Parent To' },
        remoteIds: ['child-transaction'],
    };
}

function captureTransactionRequests(): CapturedRequest[] {
    const captured: CapturedRequest[] = [];

    globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const transaction: bkper.Transaction = await request.clone().json();
            captured.push({ url: request.url, transaction });

            return new Response(
                JSON.stringify({
                    transaction: {
                        ...transaction,
                        checked: request.url.includes('/uncheck') ? false : transaction.checked,
                        trashed: request.url.includes('/trash'),
                    },
                }),
                { headers: { 'content-type': 'application/json' } }
            );
        },
        { preconnect: originalFetch.preconnect }
    );

    return captured;
}

function createHandler(): TestEventHandlerTransactionDeleted {
    return new TestEventHandlerTransactionDeleted(new AppContext(new Bkper()));
}

describe('EventHandlerTransactionDeleted legacy behavior', () => {
    test('does nothing when no connected parent transaction exists', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        parentBook.listTransactions = async () => new TransactionList(parentBook, { items: [] });
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(childBook, parentBook, buildEvent());

        expect(result).toBeNull();
        expect(requests).toHaveLength(0);
    });

    test('trashes an unchecked connected transaction without unchecking it', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        parentBook.listTransactions = async () =>
            new TransactionList(parentBook, { items: [buildConnectedTransaction(false)] });
        parentBook.getAccount = async id => {
            if (id === 'parent-credit') {
                return new Account(parentBook, { id, name: 'Parent From' });
            }
            if (id === 'parent-debit') {
                return new Account(parentBook, { id, name: 'Parent To' });
            }
            return undefined;
        };
        const requests = captureTransactionRequests();

        await createHandler().processChildEvent(childBook, parentBook, buildEvent());

        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/transactions/trash?'
        );
    });

    test('unchecks before trashing a checked connected transaction', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const connectedTransaction = buildConnectedTransaction();
        parentBook.listTransactions = async query => {
            expect(query).toBe('remoteId:child-transaction');
            return new TransactionList(parentBook, { items: [connectedTransaction] });
        };
        parentBook.getAccount = async id => {
            if (id === 'parent-credit') {
                return new Account(parentBook, { id, name: 'Parent From' });
            }
            if (id === 'parent-debit') {
                return new Account(parentBook, { id, name: 'Parent To' });
            }
            return undefined;
        };
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(childBook, parentBook, buildEvent());

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=parent-book'>Parent Book</a>: DELETED: 2026-07-30 125.50 Parent From Parent To Invoice #1042"
        );
        expect(requests.map(request => request.url)).toEqual([
            'https://api.bkper.app/v5/books/parent-book/transactions/uncheck?',
            'https://api.bkper.app/v5/books/parent-book/transactions/trash?',
        ]);
        expect(requests[1].transaction.checked).toBe(false);
    });
});
