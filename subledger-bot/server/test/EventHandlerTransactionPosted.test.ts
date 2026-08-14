import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, TransactionList, type Transaction } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerTransactionPosted } from '../src/events/handlers/EventHandlerTransactionPosted';

class TestEventHandlerTransactionPosted extends EventHandlerTransactionPosted {
    processChildEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processChildBookEvent(childBook, parentBook, event);
    }
}

interface Fixture {
    childBook: Book;
    parentBook: Book;
    childCreditAccount: Account;
    childDebitAccount: Account;
    parentCreditAccount: Account;
    parentDebitAccount: Account;
    queries: string[];
    setConnectedTransaction(transaction?: bkper.Transaction): void;
    removeParentCreditAccount(): void;
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

function createFixture(): Fixture {
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
    let connectedTransaction: bkper.Transaction | undefined;
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
        childCreditAccount,
        childDebitAccount,
        parentCreditAccount,
        parentDebitAccount,
        queries,
        setConnectedTransaction(transaction?: bkper.Transaction): void {
            connectedTransaction = transaction;
        },
        removeParentCreditAccount(): void {
            parentAccounts.delete('parent-credit');
            parentAccounts.delete('Child From');
        },
    };
}

function buildEvent(transaction: bkper.Transaction): bkper.Event {
    return {
        data: { object: { transaction } },
    };
}

function buildChildTransaction(properties: Record<string, string> = {}): bkper.Transaction {
    return {
        id: 'child-transaction',
        date: '2026-07-30',
        amount: '125.50',
        description: 'Invoice #1042',
        posted: true,
        properties,
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
                        posted: request.url.includes('/transactions/post'),
                    },
                }),
                { headers: { 'content-type': 'application/json' } }
            );
        },
        { preconnect: originalFetch.preconnect }
    );

    return captured;
}

function createHandler(): TestEventHandlerTransactionPosted {
    return new TestEventHandlerTransactionPosted(new AppContext(new Bkper()));
}

describe('EventHandlerTransactionPosted legacy behavior', () => {
    test('creates one complete parent movement with the same direction and amount', async () => {
        const fixture = createFixture();
        const requests = captureTransactionRequests();
        const childTransaction = buildChildTransaction({
            invoice: '1042',
            hidden_: 'do-not-copy',
        });

        const result = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(childTransaction)
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: 2026-07-30 125.5 Child From Child To Invoice #1042"
        );
        expect(fixture.queries).toEqual(['remoteId:child-transaction']);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PATCH');
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/transactions/post?'
        );
        expect(requests[0].transaction).toMatchObject({
            date: '2026-07-30',
            amount: '125.5',
            description: 'Invoice #1042',
            creditAccount: { id: 'parent-credit', name: 'Child From' },
            debitAccount: { id: 'parent-debit', name: 'Child To' },
            properties: {
                invoice: '1042',
                child_from: 'Child From',
                child_to: 'Child To',
            },
            remoteIds: ['child-transaction'],
        });
        expect(requests[0].transaction.properties?.hidden_).toBeUndefined();
    });

    test('creates an unresolved movement as a draft instead of posting it', async () => {
        const fixture = createFixture();
        fixture.removeParentCreditAccount();
        const requests = captureTransactionRequests();
        const childTransaction = buildChildTransaction();
        childTransaction.description = '  Invoice #1042  ';

        await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(childTransaction)
        );

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/parent-book/transactions?');
        expect(requests[0].transaction.creditAccount).toBeUndefined();
        expect(requests[0].transaction.debitAccount?.id).toBe('parent-debit');
        expect(requests[0].transaction.amount).toBe('125.5');
        expect(requests[0].transaction.description).toBe('Invoice #1042');
        expect(requests[0].transaction.posted).not.toBe(true);
    });

    test('uses parent_amount and skips consolidation when it is zero', async () => {
        const fixture = createFixture();
        const requests = captureTransactionRequests();

        const overrideResult = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(buildChildTransaction({ parent_amount: '250.00' }))
        );

        expect(overrideResult).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: 2026-07-30 250 Child From Child To Invoice #1042"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PATCH');
        expect(requests[0].url).toBe(
            'https://api.bkper.app/v5/books/parent-book/transactions/post?'
        );
        expect(requests[0].transaction.amount).toBe('250');

        requests.length = 0;
        const result = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(buildChildTransaction({ parent_amount: '0' }))
        );

        expect(result).toBeNull();
        expect(requests).toHaveLength(0);
    });

    test('uses an existing remote-id match instead of creating a duplicate', async () => {
        const fixture = createFixture();
        fixture.setConnectedTransaction({
            id: 'parent-transaction',
            date: '2026-07-30',
            dateFormatted: '2026-07-30',
            amount: '125.50',
            description: 'Invoice #1042',
            posted: false,
            creditAccount: fixture.parentCreditAccount.json(),
            debitAccount: fixture.parentDebitAccount.json(),
            remoteIds: ['child-transaction'],
        });
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBe(
            "<a href='https://bkper.app/books/parent-book/transactions'>Parent Book</a>: POSTED: 2026-07-30 125.50 Child From Child To Invoice #1042"
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PATCH');
        expect(requests[0].url).toContain('/transactions/post?');
        expect(requests[0].transaction.id).toBe('parent-transaction');
    });

    test('leaves an existing posted remote-id match unchanged', async () => {
        const fixture = createFixture();
        fixture.setConnectedTransaction({
            id: 'parent-transaction',
            date: '2026-07-30',
            amount: '125.50',
            description: 'Invoice #1042',
            posted: true,
            creditAccount: fixture.parentCreditAccount.json(),
            debitAccount: fixture.parentDebitAccount.json(),
            remoteIds: ['child-transaction'],
        });
        const requests = captureTransactionRequests();

        const result = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(buildChildTransaction())
        );

        expect(result).toBeNull();
        expect(fixture.queries).toEqual(['remoteId:child-transaction']);
        expect(requests).toHaveLength(0);
    });

    test('ignores a child transaction that is not posted', async () => {
        const fixture = createFixture();
        const requests = captureTransactionRequests();
        const childTransaction = buildChildTransaction();
        childTransaction.posted = false;

        const result = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(childTransaction)
        );

        expect(result).toBeNull();
        expect(fixture.queries).toHaveLength(0);
        expect(requests).toHaveLength(0);
    });

    test('skips transactions created by the Exchange Bot agent', async () => {
        const fixture = createFixture();
        const requests = captureTransactionRequests();
        const childTransaction = buildChildTransaction();
        childTransaction.agentId = 'exchange-bot';

        const result = await createHandler().processChildEvent(
            fixture.childBook,
            fixture.parentBook,
            buildEvent(childTransaction)
        );

        expect(result).toBeNull();
        expect(fixture.queries).toHaveLength(0);
        expect(requests).toHaveLength(0);
    });
});
