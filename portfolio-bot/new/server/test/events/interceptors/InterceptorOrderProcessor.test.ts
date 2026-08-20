import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, BkperError, Book, Transaction } from 'bkper-js';
import { EventHandlerTransactionPosted } from '../../../src/events/handlers/EventHandlerTransactionPosted.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalAccountCreate = Account.prototype.create;
const originalTransactionPost = Transaction.prototype.post;

interface RecordingBoundary {
    createdAccounts: Account[];
    postedTransactions: bkper.Transaction[];
}

let boundary: RecordingBoundary;
let accountsByBook: Map<string, Map<string, Account>>;

beforeEach(() => {
    boundary = { createdAccounts: [], postedTransactions: [] };
    accountsByBook = new Map();

    Account.prototype.create = async function (): Promise<Account> {
        const accountBook: unknown = Reflect.get(this, 'book');
        if (!(accountBook instanceof Book)) {
            throw new Error('Created Account has no Book');
        }
        const name = this.getName();
        const persistedAccount = new Account(accountBook, {
            ...this.json(),
            id: `created-${name?.toLowerCase().replaceAll(' ', '-')}`,
        });
        boundary.createdAccounts.push(persistedAccount);
        if (name) {
            getAccountMap(accountBook.getId()).set(name, persistedAccount);
        }
        return persistedAccount;
    };

    Transaction.prototype.post = async function (): Promise<Transaction> {
        const payload = this.json();
        boundary.postedTransactions.push(payload);
        const creditName = payload.creditAccount?.name;
        const debitName = payload.debitAccount?.name;
        this.getCreditAccountName = async () => creditName;
        this.getDebitAccountName = async () => debitName;
        return this;
    };
});

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
    Transaction.prototype.post = originalTransactionPost;
});

function getAccountMap(bookId: string): Map<string, Account> {
    let accountMap = accountsByBook.get(bookId);
    if (!accountMap) {
        accountMap = new Map();
        accountsByBook.set(bookId, accountMap);
    }
    return accountMap;
}

function createBook(
    properties: Record<string, string> = {},
    portfolioProperties: Record<string, string> = { stock_book: 'true' }
): Book {
    const book = new Book({
        id: 'financial',
        name: 'Financial',
        fractionDigits: 2,
        properties,
        collection: {
            books: [
                { id: 'financial', name: 'Financial', fractionDigits: 2, properties },
                {
                    id: 'portfolio',
                    name: 'Portfolio',
                    fractionDigits: 0,
                    properties: portfolioProperties,
                },
            ],
        },
    });
    book.getAccount = async idOrName => {
        const account = getAccountMap(book.getId()).get(idOrName ?? '');
        if (account) {
            return account;
        }
        throw new BkperError(404, `Account ${idOrName} not found`, 'notFound');
    };
    return book;
}

function registerAccount(
    book: Book,
    name: string,
    type: AccountType,
    properties: Record<string, string> = {}
): Account {
    const account = new Account(book, {
        id: name.toLowerCase().replaceAll(' ', '-'),
        name,
        type,
        properties,
    });
    getAccountMap(book.getId()).set(name, account);
    return account;
}

function createTransaction(
    overrides: Partial<bkper.Transaction> = {},
    properties: Record<string, string> = {}
): bkper.Transaction {
    return {
        id: 'order-1',
        posted: true,
        date: '2024-01-05',
        dateValue: 20240105,
        amount: '110',
        description: 'ACME trade',
        creditAccount: {
            id: 'cash',
            name: 'Cash',
            type: AccountType.ASSET,
            properties: {},
        },
        debitAccount: {
            id: 'broker',
            name: 'Broker',
            type: AccountType.ASSET,
            properties: { stock_fees_account: 'Broker Fees' },
        },
        properties: {
            instrument: 'ACME',
            trade_date: '2024-01-02',
            quantity: '10',
            fees: '5',
            interest: '2',
            order: '2.4',
            ...properties,
        },
        ...overrides,
    };
}

function createEvent(transaction: bkper.Transaction, agentId = 'user'): bkper.Event {
    return {
        type: 'TRANSACTION_POSTED',
        bookId: 'financial',
        user: { username: 'tester' },
        agent: { id: agentId },
        data: { object: { transaction } },
    };
}

function createHandler(book: Book): EventHandlerTransactionPosted {
    const bkper = new Bkper();
    bkper.getBook = async () => book;
    return new EventHandlerTransactionPosted(
        new AppContext(bkper, {
            ASSETS: { fetch },
        })
    );
}

function transactionByRemoteId(remoteId: string): bkper.Transaction {
    const transaction = boundary.postedTransactions.find(candidate =>
        candidate.remoteIds?.includes(remoteId)
    );
    if (!transaction) {
        throw new Error(`Missing posted transaction ${remoteId}`);
    }
    return transaction;
}

function expectCompleteMovement(transaction: bkper.Transaction): void {
    expect(transaction.amount).toBeTruthy();
    expect(transaction.amount).not.toBe('0');
    expect(transaction.creditAccount?.name).toBeTruthy();
    expect(transaction.debitAccount?.name).toBeTruthy();
}

describe('legacy posted order processing', () => {
    test('preserves the non-order, loop-prevention, and unsupported no-op paths', async () => {
        const cases: { book: Book; transaction: bkper.Transaction; agentId?: string }[] = [
            { book: createBook(), transaction: createTransaction(), agentId: 'exchange-bot' },
            {
                book: createBook({ stock_book: 'true' }),
                transaction: createTransaction(),
            },
            {
                book: createBook(),
                transaction: createTransaction({ posted: false }),
            },
            {
                book: createBook(),
                transaction: createTransaction({
                    properties: { instrument: 'ACME', trade_date: '2024-01-02' },
                }),
            },
            {
                book: createBook(),
                transaction: createTransaction({ properties: { quantity: '10' } }),
            },
        ];

        for (const testCase of cases) {
            const result = await createHandler(testCase.book).handleEvent(
                createEvent(testCase.transaction, testCase.agentId)
            );
            expect(result).toEqual({ result: false });
        }

        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.postedTransactions).toEqual([]);
    });

    test('rejects a recognized order with zero quantity before creating any movement', async () => {
        const handler = createHandler(createBook());

        await expect(
            handler.handleEvent(createEvent(createTransaction({}, { quantity: '0' })))
        ).rejects.toBe('Quantity must not be zero');
        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.postedTransactions).toEqual([]);
    });

    test('splits a purchase into complete fee, interest, and instrument movements', async () => {
        const book = createBook(
            {},
            {
                stock_book: 'true',
                stock_historical: 'true',
                stock_fair: 'true',
            }
        );
        const result = await createHandler(book).handleEvent(
            createEvent(
                createTransaction(
                    {},
                    {
                        cost_base: '206',
                        cost_hist: '1007',
                        cost_hist_base: '2014',
                    }
                )
            )
        );

        expect(boundary.createdAccounts.map(account => account.json())).toEqual([
            expect.objectContaining({ name: 'Broker Fees', type: AccountType.OUTGOING }),
            expect.objectContaining({ name: 'ACME Interest', type: AccountType.ASSET }),
            expect.objectContaining({ name: 'ACME', type: AccountType.ASSET }),
        ]);
        expect(boundary.postedTransactions).toHaveLength(3);
        boundary.postedTransactions.forEach(expectCompleteMovement);

        expect(transactionByRemoteId('fees_order-1')).toEqual(
            expect.objectContaining({
                amount: '5',
                date: '2024-01-02',
                description: 'ACME trade',
                creditAccount: expect.objectContaining({ name: 'Broker' }),
                debitAccount: expect.objectContaining({ name: 'Broker Fees' }),
            })
        );
        expect(transactionByRemoteId('interest_order-1')).toEqual(
            expect.objectContaining({
                amount: '2',
                creditAccount: expect.objectContaining({ name: 'Broker' }),
                debitAccount: expect.objectContaining({ name: 'ACME Interest' }),
            })
        );
        expect(transactionByRemoteId('instrument_order-1')).toEqual(
            expect.objectContaining({
                amount: '103',
                creditAccount: expect.objectContaining({ name: 'Broker' }),
                debitAccount: expect.objectContaining({ name: 'ACME' }),
                properties: {
                    quantity: '10',
                    price: '10.3',
                    order: '2',
                    settlement_date: '2024-01-05',
                    fees: '5',
                    interest: '2',
                    trade_exc_rate: '2',
                    price_hist: '100',
                    trade_exc_rate_hist: '2',
                },
            })
        );
        expect(result.result).toEqual([
            '2024-01-02 5 Broker Broker Fees ACME trade',
            '2024-01-02 2 Broker ACME Interest ACME trade',
            '2024-01-02 103 Broker ACME ACME trade',
        ]);
    });

    test('preserves sale directions and omits historical properties outside the combined model', async () => {
        const book = createBook({}, { stock_book: 'true', stock_fair: 'true' });
        registerAccount(book, 'Broker Fees', AccountType.OUTGOING);
        registerAccount(book, 'ACME Interest', AccountType.ASSET);
        registerAccount(book, 'ACME', AccountType.ASSET);
        const transaction = createTransaction(
            {
                creditAccount: {
                    id: 'broker',
                    name: 'Broker',
                    type: AccountType.ASSET,
                    properties: { stock_fees_account: 'Broker Fees' },
                },
                debitAccount: {
                    id: 'cash',
                    name: 'Cash',
                    type: AccountType.ASSET,
                    properties: {},
                },
            },
            { cost_base: '226', cost_hist: '1007', cost_hist_base: '2014' }
        );

        const result = await createHandler(book).handleEvent(createEvent(transaction));

        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.postedTransactions).toHaveLength(3);
        boundary.postedTransactions.forEach(expectCompleteMovement);
        expect(transactionByRemoteId('fees_order-1')).toEqual(
            expect.objectContaining({
                creditAccount: expect.objectContaining({ name: 'Broker' }),
                debitAccount: expect.objectContaining({ name: 'Broker Fees' }),
            })
        );
        expect(transactionByRemoteId('interest_order-1')).toEqual(
            expect.objectContaining({
                creditAccount: expect.objectContaining({ name: 'ACME Interest' }),
                debitAccount: expect.objectContaining({ name: 'Broker' }),
            })
        );
        expect(transactionByRemoteId('instrument_order-1')).toEqual(
            expect.objectContaining({
                amount: '113',
                creditAccount: expect.objectContaining({ name: 'ACME' }),
                debitAccount: expect.objectContaining({ name: 'Broker' }),
                properties: {
                    quantity: '10',
                    price: '11.3',
                    order: '2',
                    settlement_date: '2024-01-05',
                    fees: '5',
                    interest: '2',
                    trade_exc_rate: '2',
                },
            })
        );
        expect(result.result).toHaveLength(3);
    });

    test('preserves combined-model historical sale calculations', async () => {
        const book = createBook(
            {},
            {
                stock_book: 'true',
                stock_historical: 'true',
                stock_fair: 'true',
            }
        );
        registerAccount(book, 'Broker Fees', AccountType.OUTGOING);
        registerAccount(book, 'ACME Interest', AccountType.ASSET);
        registerAccount(book, 'ACME', AccountType.ASSET);
        const transaction = createTransaction(
            {
                creditAccount: {
                    id: 'broker',
                    name: 'Broker',
                    type: AccountType.ASSET,
                    properties: { stock_fees_account: 'Broker Fees' },
                },
                debitAccount: {
                    id: 'cash',
                    name: 'Cash',
                    type: AccountType.ASSET,
                    properties: {},
                },
            },
            { cost_base: '226', cost_hist: '1007', cost_hist_base: '2014' }
        );

        await createHandler(book).handleEvent(createEvent(transaction));

        expect(boundary.postedTransactions).toHaveLength(3);
        boundary.postedTransactions.forEach(expectCompleteMovement);
        expect(transactionByRemoteId('instrument_order-1')).toEqual(
            expect.objectContaining({
                amount: '113',
                creditAccount: expect.objectContaining({ name: 'ACME' }),
                debitAccount: expect.objectContaining({ name: 'Broker' }),
                properties: {
                    quantity: '10',
                    price: '11.3',
                    order: '2',
                    settlement_date: '2024-01-05',
                    fees: '5',
                    interest: '2',
                    trade_exc_rate: '2',
                    price_hist: '101',
                    trade_exc_rate_hist: '2',
                },
            })
        );
    });

    test('does not create fee or interest movements for zero amounts', async () => {
        const book = createBook();
        registerAccount(book, 'ACME', AccountType.ASSET);

        const result = await createHandler(book).handleEvent(
            createEvent(createTransaction({}, { fees: '0', interest: '0' }))
        );

        expect(boundary.postedTransactions).toHaveLength(1);
        expect(boundary.postedTransactions[0].remoteIds).toEqual(['instrument_order-1']);
        expectCompleteMovement(boundary.postedTransactions[0]);
        expect(result.result).toHaveLength(1);
    });
});
