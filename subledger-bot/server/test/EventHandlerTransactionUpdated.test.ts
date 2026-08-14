import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerTransactionUpdated } from '../src/events/handlers/EventHandlerTransactionUpdated';

class TestEventHandlerTransactionUpdated extends EventHandlerTransactionUpdated {
    processChildEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processChildBookEvent(childBook, parentBook, event);
    }
}

interface CapturedRequest {
    method: string;
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

function createAccount(book: Book, id: string, name: string): Account {
    const account = new Account(book, { id, name, type: AccountType.ASSET });
    account.getGroups = async () => [];
    return account;
}

function buildChildTransaction(properties: Record<string, string> = {}): bkper.Transaction {
    return {
        id: 'child-transaction',
        date: '2026-07-30',
        amount: '125.50',
        description: 'Updated invoice',
        posted: true,
        properties,
        urls: ['https://example.com/invoice'],
        files: [{ url: 'https://example.com/attachment' }],
        creditAccount: { id: 'child-credit', name: 'Child From' },
        debitAccount: { id: 'child-debit', name: 'Child To' },
    };
}

function buildEvent(transaction: bkper.Transaction): bkper.Event {
    return { data: { object: { transaction } } };
}

function buildConnectedTransaction(checked = false): bkper.Transaction {
    return {
        id: 'parent-transaction',
        date: '2026-07-29',
        dateFormatted: '2026-07-29',
        amount: '100',
        description: 'Original invoice',
        posted: true,
        checked,
        properties: {},
        creditAccount: { id: 'parent-credit', name: 'Child From' },
        debitAccount: { id: 'parent-debit', name: 'Child To' },
        remoteIds: ['child-transaction'],
    };
}

function createSetup(connectedTransaction?: bkper.Transaction): {
    childBook: Book;
    parentBook: Book;
    queries: string[];
    removeParentDebitAccount(): void;
} {
    const childBook = createBook('child-book', 'Child Book');
    const parentBook = createBook('parent-book', 'Parent Book');
    const childCreditAccount = createAccount(childBook, 'child-credit', 'Child From');
    const childDebitAccount = createAccount(childBook, 'child-debit', 'Child To');
    const parentCreditAccount = createAccount(parentBook, 'parent-credit', 'Child From');
    const parentDebitAccount = createAccount(parentBook, 'parent-debit', 'Child To');
    const parentAccounts = new Map<string, Account>([
        ['parent-credit', parentCreditAccount],
        ['Child From', parentCreditAccount],
        ['parent-debit', parentDebitAccount],
        ['Child To', parentDebitAccount],
    ]);
    const queries: string[] = [];

    childBook.getAccount = async id => {
        if (id === 'child-credit') {
            return childCreditAccount;
        }
        if (id === 'child-debit') {
            return childDebitAccount;
        }
        return undefined;
    };
    parentBook.getAccount = async idOrName => parentAccounts.get(idOrName ?? '');
    parentBook.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(parentBook, {
            items: connectedTransaction ? [connectedTransaction] : [],
        });
    };

    return {
        childBook,
        parentBook,
        queries,
        removeParentDebitAccount(): void {
            parentAccounts.delete('parent-debit');
            parentAccounts.delete('Child To');
        },
    };
}

function captureTransactionRequests(): CapturedRequest[] {
    const captured: CapturedRequest[] = [];

    globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const transaction: bkper.Transaction = await request.clone().json();
            captured.push({ method: request.method, url: request.url, transaction });

            return new Response(
                JSON.stringify({
                    transaction: {
                        ...transaction,
                        dateFormatted: transaction.date,
                        checked: request.url.includes('/uncheck') ? false : transaction.checked,
                    },
                }),
                { headers: { 'content-type': 'application/json' } }
            );
        },
        { preconnect: originalFetch.preconnect }
    );

    return captured;
}

function createHandler(): TestEventHandlerTransactionUpdated {
    return new TestEventHandlerTransactionUpdated(new AppContext(new Bkper()));
}

describe('EventHandlerTransactionUpdated legacy behavior', () => {
    test('does nothing when no connected parent transaction exists', async () => {
        const setup = createSetup();
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBeNull();
        expect(setup.queries).toEqual(['remoteId:child-transaction']);
        expect(requests).toHaveLength(0);
    });

    test('unchecks and updates the connected movement without reversing direction or amount', async () => {
        const setup = createSetup(buildConnectedTransaction(true));
        const requests = captureTransactionRequests();
        const childTransaction = buildChildTransaction({
            parent_amount: '250.00',
            invoice: '1042',
            hidden_: 'do-not-copy',
        });

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(childTransaction)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: EDITED: 2026-07-30 250.00 Child From Child To Updated invoice"
        );
        expect(requests.map(request => request.url)).toEqual([
            'https://api.bkper.app/v5/books/parent-book/transactions/uncheck?',
            'https://api.bkper.app/v5/books/parent-book/transactions?',
        ]);
        expect(requests[1].method).toBe('PUT');
        expect(requests[1].transaction).toMatchObject({
            id: 'parent-transaction',
            date: '2026-07-30',
            amount: '250',
            description: 'Updated invoice',
            creditAccount: { id: 'parent-credit', name: 'Child From' },
            debitAccount: { id: 'parent-debit', name: 'Child To' },
            properties: {
                parent_amount: '250.00',
                invoice: '1042',
                child_from: 'Child From',
                child_to: 'Child To',
            },
            remoteIds: ['child-transaction', 'child-transaction'],
            urls: ['https://example.com/invoice', 'https://example.com/attachment'],
        });
        expect(requests[1].transaction.properties?.hidden_).toBeUndefined();
    });

    test('copies file URLs when the child transaction has no URLs array', async () => {
        const setup = createSetup(buildConnectedTransaction());
        const requests = captureTransactionRequests();
        const childTransaction = buildChildTransaction();
        childTransaction.urls = undefined;

        await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(childTransaction)
        );

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].transaction.urls).toEqual(['https://example.com/attachment']);
    });

    test('does not mutate a connected transaction when either mapped Account is unresolved', async () => {
        const setup = createSetup(buildConnectedTransaction(true));
        setup.removeParentDebitAccount();
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBeNull();
        expect(requests).toHaveLength(0);
    });

    test('preserves the current parent_amount zero behavior on a checked transaction', async () => {
        const setup = createSetup(buildConnectedTransaction(true));
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction({ parent_amount: '0' }))
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: EDITED: 2026-07-29 100.00 Child From Child To Original invoice"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/transactions/uncheck?'
        );
    });
});
