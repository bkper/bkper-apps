import { afterEach, describe, expect, test } from 'bun:test';
import { Account, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerTransactionRestored } from '../src/events/handlers/EventHandlerTransactionRestored';

class TestEventHandlerTransactionRestored extends EventHandlerTransactionRestored {
    processChildEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processChildBookEvent(childBook, parentBook, event);
    }
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

function createHandler(): TestEventHandlerTransactionRestored {
    return new TestEventHandlerTransactionRestored(new AppContext(new Bkper()));
}

describe('EventHandlerTransactionRestored legacy behavior', () => {
    test('finds the trashed remote-id match and untrashes it', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const connectedTransaction: bkper.Transaction = {
            id: 'parent-transaction',
            date: '2026-07-30',
            dateFormatted: '2026-07-30',
            amount: '125.50',
            description: 'Invoice #1042',
            posted: true,
            trashed: true,
            creditAccount: { id: 'parent-credit', name: 'Parent From' },
            debitAccount: { id: 'parent-debit', name: 'Parent To' },
            remoteIds: ['child-transaction'],
        };
        parentBook.listTransactions = async query => {
            expect(query).toBe('remoteId:child-transaction is:trashed');
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
        const requests: Request[] = [];
        globalThis.fetch = Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const request = input instanceof Request ? input : new Request(input, init);
                requests.push(request);
                const transaction: bkper.Transaction = await request.clone().json();
                return new Response(
                    JSON.stringify({ transaction: { ...transaction, trashed: false } }),
                    { headers: { 'content-type': 'application/json' } }
                );
            },
            { preconnect: originalFetch.preconnect }
        );

        const result = await createHandler().processChildEvent(childBook, parentBook, buildEvent());

        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=parent-book'>Parent Book</a>: RESTORED: 2026-07-30 125.50 Parent From Parent To Invoice #1042"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PATCH');
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/transactions/restore?'
        );
    });
});
