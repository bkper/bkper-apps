import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerTransactionChecked } from '../src/events/handlers/EventHandlerTransactionChecked';

class TestEventHandlerTransactionChecked extends EventHandlerTransactionChecked {
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

function buildEvent(transaction: bkper.Transaction): bkper.Event {
    return { data: { object: { transaction } } };
}

function buildChildTransaction(): bkper.Transaction {
    return {
        id: 'child-transaction',
        date: '2026-07-30',
        amount: '125.50',
        description: 'Invoice #1042',
        posted: true,
        properties: {},
        creditAccount: { id: 'child-credit', name: 'Child From' },
        debitAccount: { id: 'child-debit', name: 'Child To' },
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
                        posted: transaction.posted || request.url.includes('/transactions/post'),
                        checked: request.url.includes('/transactions/check'),
                    },
                }),
                { headers: { 'content-type': 'application/json' } }
            );
        },
        { preconnect: originalFetch.preconnect }
    );

    return captured;
}

function createSetup(connectedTransaction?: bkper.Transaction): {
    childBook: Book;
    parentBook: Book;
    parentCreditAccount: Account;
    parentDebitAccount: Account;
    queries: string[];
    removeParentCreditAccount(): void;
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
        parentCreditAccount,
        parentDebitAccount,
        queries,
        removeParentCreditAccount(): void {
            parentAccounts.delete('parent-credit');
            parentAccounts.delete('Child From');
        },
    };
}

function createHandler(): TestEventHandlerTransactionChecked {
    return new TestEventHandlerTransactionChecked(new AppContext(new Bkper()));
}

describe('EventHandlerTransactionChecked legacy behavior', () => {
    test('posts and checks a new complete parent movement', async () => {
        const setup = createSetup();
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: 2026-07-30 125.5 Child From Child To Invoice #1042"
        );
        expect(setup.queries).toEqual(['remoteId:child-transaction']);
        expect(requests.map(request => request.url)).toEqual([
            'https://api.bkper.app/v5/books/parent-book/transactions/post?',
            'https://api.bkper.app/v5/books/parent-book/transactions/check?',
        ]);
        expect(requests[0].transaction).toMatchObject({
            amount: '125.5',
            creditAccount: { id: 'parent-credit' },
            debitAccount: { id: 'parent-debit' },
            remoteIds: ['child-transaction'],
        });
        expect(requests[1].transaction.posted).toBe(true);
    });

    test('creates an unresolved checked movement as a draft without checking it', async () => {
        const setup = createSetup();
        setup.removeParentCreditAccount();
        const requests = captureTransactionRequests();

        await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/parent-book/transactions?');
        expect(requests[0].transaction.creditAccount).toBeUndefined();
        expect(requests[0].transaction.checked).not.toBe(true);
    });

    test('checks an existing posted and unchecked remote-id match', async () => {
        const connectedTransaction: bkper.Transaction = {
            id: 'parent-transaction',
            date: '2026-07-30',
            dateFormatted: '2026-07-30',
            amount: '125.50',
            description: 'Invoice #1042',
            posted: true,
            checked: false,
            creditAccount: { id: 'parent-credit', name: 'Child From' },
            debitAccount: { id: 'parent-debit', name: 'Child To' },
            remoteIds: ['child-transaction'],
        };
        const setup = createSetup(connectedTransaction);
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: CHECKED: 2026-07-30 125.50 Child From Child To Invoice #1042"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/transactions/check?'
        );
        expect(requests[0].transaction.id).toBe('parent-transaction');
    });

    test('returns the legacy checked response for an incomplete connected draft', async () => {
        const incompleteDraft: bkper.Transaction = {
            id: 'parent-transaction',
            date: '2026-07-29',
            dateFormatted: '2026-07-29',
            amount: '100',
            description: 'Original invoice',
            posted: false,
            checked: false,
            debitAccount: { id: 'parent-debit', name: 'Child To' },
            remoteIds: ['child-transaction'],
        };
        const setup = createSetup(incompleteDraft);
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: CHECKED: 2026-07-29 100.00  Child To Original invoice"
        );
        expect(requests).toHaveLength(0);
    });

    test('leaves an existing checked transaction unchanged', async () => {
        const connectedTransaction: bkper.Transaction = {
            id: 'parent-transaction',
            date: '2026-07-30',
            dateFormatted: '2026-07-30',
            amount: '125.50',
            description: 'Invoice #1042',
            posted: true,
            checked: true,
            creditAccount: { id: 'parent-credit', name: 'Child From' },
            debitAccount: { id: 'parent-debit', name: 'Child To' },
            remoteIds: ['child-transaction'],
        };
        const setup = createSetup(connectedTransaction);
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: CHECKED: 2026-07-30 125.50 Child From Child To Invoice #1042"
        );
        expect(requests).toHaveLength(0);
    });

    test('posts before checking an existing complete draft', async () => {
        const connectedTransaction: bkper.Transaction = {
            id: 'parent-transaction',
            date: '2026-07-30',
            dateFormatted: '2026-07-30',
            amount: '125.50',
            description: 'Invoice #1042',
            posted: false,
            checked: false,
            creditAccount: { id: 'parent-credit', name: 'Child From' },
            debitAccount: { id: 'parent-debit', name: 'Child To' },
            remoteIds: ['child-transaction'],
        };
        const setup = createSetup(connectedTransaction);
        const requests = captureTransactionRequests();

        await createHandler().processChildEvent(
            setup.childBook,
            setup.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(requests.map(request => request.url)).toEqual([
            'https://api.bkper.app/v5/books/parent-book/transactions/post?',
            'https://api.bkper.app/v5/books/parent-book/transactions/check?',
        ]);
    });
});
