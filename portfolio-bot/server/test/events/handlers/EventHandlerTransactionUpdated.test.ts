import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Transaction, TransactionList } from 'bkper-js';
import { EventHandlerTransactionUpdated } from '../../../src/events/handlers/EventHandlerTransactionUpdated.js';
import { InterceptorOrderProcessor } from '../../../src/events/interceptors/InterceptorOrderProcessor.js';
import { InterceptorOrderProcessorDeleteFinancial } from '../../../src/events/interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { AppContext } from '../../../src/shared/app-context.js';
import type { EventResult } from '../../../src/events/types.js';

class TestEventHandlerTransactionUpdated extends EventHandlerTransactionUpdated {
    interceptEvent(book: Book, event: bkper.Event): Promise<EventResult> {
        return this.intercept(book, event);
    }

    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }
}

const originalAccountUpdate = Account.prototype.update;
const originalDeleteIntercept = InterceptorOrderProcessorDeleteFinancial.prototype.intercept;
const originalOrderIntercept = InterceptorOrderProcessor.prototype.intercept;
const originalTransactionUncheck = Transaction.prototype.uncheck;
const originalTransactionUpdate = Transaction.prototype.update;

let accountUpdates: bkper.Account[];
let transactionMutations: { operation: 'uncheck' | 'update'; transaction: bkper.Transaction }[];
let updateFailures: Set<string>;

beforeEach(() => {
    accountUpdates = [];
    transactionMutations = [];
    updateFailures = new Set();

    Account.prototype.update = async function (): Promise<Account> {
        accountUpdates.push(this.json());
        return this;
    };
    Transaction.prototype.uncheck = async function (): Promise<Transaction> {
        this.setChecked(false);
        transactionMutations.push({ operation: 'uncheck', transaction: this.json() });
        return this;
    };
    Transaction.prototype.update = async function (): Promise<Transaction> {
        transactionMutations.push({ operation: 'update', transaction: this.json() });
        const id = this.getId();
        if (id && updateFailures.delete(id)) {
            throw new Error('Transaction remained checked');
        }
        return this;
    };
});

afterEach(() => {
    Account.prototype.update = originalAccountUpdate;
    InterceptorOrderProcessorDeleteFinancial.prototype.intercept = originalDeleteIntercept;
    InterceptorOrderProcessor.prototype.intercept = originalOrderIntercept;
    Transaction.prototype.uncheck = originalTransactionUncheck;
    Transaction.prototype.update = originalTransactionUpdate;
});

function createContext(): AppContext {
    return new AppContext(new Bkper(), { ASSETS: { fetch } });
}

function createEvent(
    transaction: bkper.Transaction,
    previousAttributes?: Record<string, string>
): bkper.Event {
    return {
        type: 'TRANSACTION_UPDATED',
        user: { username: 'tester' },
        agent: { id: 'user' },
        data: { object: { transaction }, previousAttributes },
    };
}

function createFinancialTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'financial-trade',
        posted: true,
        checked: true,
        date: '2024-01-02',
        amount: '120',
        description: 'New description',
        creditAccount: {
            id: 'financial-cash',
            name: 'Cash',
            type: AccountType.ASSET,
            properties: {},
        },
        debitAccount: {
            id: 'financial-acme',
            name: 'ACME',
            type: AccountType.ASSET,
            groups: [
                {
                    id: 'financial-market',
                    name: 'NASDAQ',
                    properties: { stock_exc_code: 'USD' },
                },
            ],
            properties: {},
        },
        properties: { quantity: '10' },
        ...overrides,
    };
}

function createMirrorFixture(checked: boolean): {
    financialBook: Book;
    portfolioBook: Book;
    stockAccount: Account;
} {
    const financialBook = new Book({
        id: 'financial',
        name: 'Financial',
        fractionDigits: 2,
        properties: { exc_code: 'USD' },
    });
    const portfolioBook = new Book({
        id: 'portfolio',
        name: 'Portfolio',
        fractionDigits: 0,
        properties: { stock_book: 'true' },
    });
    const buy = new Account(portfolioBook, {
        id: 'portfolio-buy',
        name: 'Buy',
        type: AccountType.INCOMING,
    });
    const stockAccount = new Account(portfolioBook, {
        id: 'portfolio-acme',
        name: 'ACME',
        type: AccountType.ASSET,
        properties: { realized_date: '2024-01-03' },
    });
    const accounts = new Map<string, Account>([
        [buy.getId()!, buy],
        [stockAccount.getId()!, stockAccount],
    ]);
    portfolioBook.getAccount = async id => accounts.get(id ?? '');
    portfolioBook.listTransactions = async () =>
        new TransactionList(portfolioBook, {
            items: [
                {
                    id: 'portfolio-mirror',
                    posted: true,
                    checked,
                    date: '2024-01-02',
                    dateFormatted: '2024-01-02',
                    dateValue: 20240102,
                    amount: '9',
                    description: 'Old description',
                    creditAccount: buy.json(),
                    debitAccount: stockAccount.json(),
                    remoteIds: ['financial-trade'],
                    properties: {},
                },
            ],
        });
    return { financialBook, portfolioBook, stockAccount };
}

function createHandler(): TestEventHandlerTransactionUpdated {
    return new TestEventHandlerTransactionUpdated(createContext());
}

describe('legacy updated transaction behavior', () => {
    test('awaits deletion before replacement and skips cleanup for no-op updates', async () => {
        const calls: string[] = [];
        let releaseDeletion: () => void = () => undefined;
        let signalDeletionStarted: () => void = () => undefined;
        const deletionStarted = new Promise<void>(resolve => {
            signalDeletionStarted = resolve;
        });
        const waitForDeletion = new Promise<void>(resolve => {
            releaseDeletion = resolve;
        });
        InterceptorOrderProcessorDeleteFinancial.prototype.intercept = async () => {
            calls.push('delete');
            signalDeletionStarted();
            await waitForDeletion;
            return { result: ['deleted'] };
        };
        InterceptorOrderProcessor.prototype.intercept = async () => {
            calls.push('replace');
            return { result: ['replaced'] };
        };
        const book = new Book({ id: 'financial', fractionDigits: 2 });
        const handlerPromise = createHandler().interceptEvent(
            book,
            createEvent(createFinancialTransaction(), { amount: '100' })
        );

        await deletionStarted;
        expect(calls).toEqual(['delete']);
        releaseDeletion();

        expect(await handlerPromise).toEqual({ result: ['replaced'] });
        expect(calls).toEqual(['delete', 'replace']);

        const noCleanupPreviousAttributes: Array<Record<string, string> | undefined> = [
            undefined,
            {},
            { description: 'Old description' },
        ];
        for (const previousAttributes of noCleanupPreviousAttributes) {
            calls.length = 0;
            await createHandler().interceptEvent(
                book,
                createEvent(createFinancialTransaction(), previousAttributes)
            );
            expect(calls).toEqual(['replace']);
        }

        const expectedError = new Error('Cleanup failed');
        calls.length = 0;
        InterceptorOrderProcessorDeleteFinancial.prototype.intercept = async () => {
            calls.push('delete');
            throw expectedError;
        };
        await expect(
            createHandler().interceptEvent(
                book,
                createEvent(createFinancialTransaction(), { amount: '100' })
            )
        ).rejects.toBe(expectedError);
        expect(calls).toEqual(['delete']);
    });

    test('preserves unposted, zero-quantity, and missing-mirror no-op paths', async () => {
        const unpostedFixture = createMirrorFixture(true);
        const unpostedResult = await createHandler().processConnectedBook(
            unpostedFixture.financialBook,
            unpostedFixture.portfolioBook,
            createEvent(createFinancialTransaction({ posted: false }), { posted: 'true' })
        );

        const zeroQuantityFixture = createMirrorFixture(true);
        const zeroQuantityResult = await createHandler().processConnectedBook(
            zeroQuantityFixture.financialBook,
            zeroQuantityFixture.portfolioBook,
            createEvent(createFinancialTransaction({ properties: { quantity: '0' } }), {
                properties: 'quantity:10',
            })
        );

        const missingMirrorFixture = createMirrorFixture(true);
        missingMirrorFixture.portfolioBook.listTransactions = async () =>
            new TransactionList(missingMirrorFixture.portfolioBook, { items: [] });
        const missingMirrorResult = await createHandler().processConnectedBook(
            missingMirrorFixture.financialBook,
            missingMirrorFixture.portfolioBook,
            createEvent(createFinancialTransaction(), { amount: '100' })
        );

        expect([unpostedResult, zeroQuantityResult, missingMirrorResult]).toEqual([
            null,
            null,
            null,
        ]);
        expect(transactionMutations).toEqual([]);
        expect(accountUpdates).toEqual([]);
    });

    test('updates a checked Portfolio mirror as one complete movement', async () => {
        const fixture = createMirrorFixture(true);

        const result = await createHandler().processConnectedBook(
            fixture.financialBook,
            fixture.portfolioBook,
            createEvent(createFinancialTransaction(), { description: 'Old description' })
        );

        expect(transactionMutations.map(mutation => mutation.operation)).toEqual([
            'uncheck',
            'update',
        ]);
        const updatedMirror = transactionMutations[1].transaction;
        expect(updatedMirror).toMatchObject({
            id: 'portfolio-mirror',
            amount: '10',
            description: 'New description',
            creditAccount: { name: 'Buy' },
            debitAccount: { name: 'ACME' },
            properties: {
                original_quantity: '10',
                original_amount: '120',
                purchase_price: '12',
            },
        });
        expect(updatedMirror.amount).not.toBe('0');
        expect(updatedMirror.creditAccount?.name).toBeTruthy();
        expect(updatedMirror.debitAccount?.name).toBeTruthy();
        expect(accountUpdates.map(account => account.id)).toEqual([fixture.stockAccount.getId()!]);
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: EDITED: 2024-01-02 10 Buy ACME New description"
        );
    });

    test('retries a mirror update after unchecking when the first update fails', async () => {
        const fixture = createMirrorFixture(false);
        updateFailures.add('portfolio-mirror');

        await createHandler().processConnectedBook(
            fixture.financialBook,
            fixture.portfolioBook,
            createEvent(createFinancialTransaction(), { description: 'Old description' })
        );

        expect(transactionMutations.map(mutation => mutation.operation)).toEqual([
            'update',
            'uncheck',
            'update',
        ]);
    });
});
