import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    Account,
    AccountType,
    Bkper,
    BkperError,
    Book,
    Group,
    Transaction,
    TransactionList,
} from 'bkper-js';
import { EventHandlerTransactionChecked } from '../../../src/events/handlers/EventHandlerTransactionChecked.js';
import { InterceptorFlagRebuild } from '../../../src/events/interceptors/InterceptorFlagRebuild.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalAccountCreate = Account.prototype.create;
const originalAccountUpdate = Account.prototype.update;
const originalGroupCreate = Group.prototype.create;
const originalTransactionPost = Transaction.prototype.post;
const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;

interface RecordingBoundary {
    createdAccounts: Account[];
    createdGroups: Group[];
    updatedAccounts: bkper.Account[];
    postedTransactions: bkper.Transaction[];
}

interface UpdateGate {
    started: Promise<void>;
    release: () => void;
}

let boundary: RecordingBoundary;
let accountsByBook: Map<string, Map<string, Account>>;
let groupsByBook: Map<string, Map<string, Group>>;
let waitForAccountUpdate: Promise<void> | null;
let signalAccountUpdateStarted: (() => void) | null;

beforeEach(() => {
    boundary = {
        createdAccounts: [],
        createdGroups: [],
        updatedAccounts: [],
        postedTransactions: [],
    };
    accountsByBook = new Map();
    groupsByBook = new Map();
    waitForAccountUpdate = null;
    signalAccountUpdateStarted = null;
    console.time = () => undefined;
    console.timeEnd = () => undefined;

    Account.prototype.create = async function (): Promise<Account> {
        const book = getResourceBook(this);
        const name = this.getName();
        const persistedAccount = new Account(book, {
            ...this.json(),
            id: `created-${name?.toLowerCase().replaceAll(' ', '-')}`,
        });
        boundary.createdAccounts.push(persistedAccount);
        if (name) {
            getAccountMap(book.getId()).set(name, persistedAccount);
        }
        return persistedAccount;
    };

    Account.prototype.update = async function (): Promise<Account> {
        boundary.updatedAccounts.push(this.json());
        signalAccountUpdateStarted?.();
        if (waitForAccountUpdate) {
            await waitForAccountUpdate;
        }
        return this;
    };

    Group.prototype.create = async function (): Promise<Group> {
        const book = getResourceBook(this);
        const name = this.getName();
        const persistedGroup = new Group(book, {
            ...this.json(),
            id: `created-${name?.toLowerCase().replaceAll(' ', '-')}`,
        });
        boundary.createdGroups.push(persistedGroup);
        if (name) {
            getGroupMap(book.getId()).set(name, persistedGroup);
        }
        return persistedGroup;
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
    Account.prototype.update = originalAccountUpdate;
    Group.prototype.create = originalGroupCreate;
    Transaction.prototype.post = originalTransactionPost;
    console.time = originalConsoleTime;
    console.timeEnd = originalConsoleTimeEnd;
});

function getResourceBook(resource: Account | Group): Book {
    const book: unknown = Reflect.get(resource, 'book');
    if (!(book instanceof Book)) {
        throw new Error('Resource has no Book');
    }
    return book;
}

function getAccountMap(bookId: string): Map<string, Account> {
    let accountMap = accountsByBook.get(bookId);
    if (!accountMap) {
        accountMap = new Map();
        accountsByBook.set(bookId, accountMap);
    }
    return accountMap;
}

function getGroupMap(bookId: string): Map<string, Group> {
    let groupMap = groupsByBook.get(bookId);
    if (!groupMap) {
        groupMap = new Map();
        groupsByBook.set(bookId, groupMap);
    }
    return groupMap;
}

function configurePortfolioLookups(book: Book): void {
    book.getAccount = async idOrName => {
        const account = getAccountMap(book.getId()).get(idOrName ?? '');
        if (account) {
            return account;
        }
        throw new BkperError(404, `Account ${idOrName} not found`, 'notFound');
    };
    book.getGroup = async idOrName => {
        const group = getGroupMap(book.getId()).get(idOrName ?? '');
        if (group) {
            return group;
        }
        throw new BkperError(404, `Group ${idOrName} not found`, 'notFound');
    };
}

function createBooks(
    financialProperties: Record<string, string> = { exc_code: 'USD' },
    portfolioProperties: Record<string, string> = { stock_book: 'true' }
): { financialBook: Book; portfolioBook: Book } {
    const financialBook = new Book({
        id: 'financial',
        name: 'Financial',
        fractionDigits: 2,
        properties: financialProperties,
        collection: {
            books: [
                {
                    id: 'financial',
                    name: 'Financial',
                    fractionDigits: 2,
                    properties: financialProperties,
                },
                {
                    id: 'portfolio',
                    name: 'Portfolio',
                    fractionDigits: 0,
                    properties: portfolioProperties,
                },
            ],
        },
    });
    const collection = financialBook.getCollection()!;
    const portfolioBook = collection.getBooks().find(book => book.getId() === 'portfolio');
    if (!portfolioBook) {
        throw new Error('Portfolio Book fixture missing');
    }
    collection.getBooks = () => [financialBook, portfolioBook];
    configurePortfolioLookups(portfolioBook);
    return { financialBook, portfolioBook };
}

function registerAccount(
    book: Book,
    name: string,
    type: AccountType,
    properties: Record<string, string> = {},
    archived = false
): Account {
    const account = new Account(book, {
        id: name.toLowerCase().replaceAll(' ', '-'),
        name,
        type,
        properties,
        archived,
    });
    const accountMap = getAccountMap(book.getId());
    accountMap.set(name, account);
    accountMap.set(account.getId()!, account);
    return account;
}

function createFinancialTransaction(
    side: 'PURCHASE' | 'SALE',
    overrides: Partial<bkper.Transaction> = {},
    properties: Record<string, string> = {}
): bkper.Transaction {
    const instrumentAccount: bkper.Account = {
        id: 'financial-acme',
        name: 'ACME',
        type: AccountType.ASSET,
        archived: false,
        properties: { ticker: 'ACME', internal_: 'hidden' },
        groups: [
            {
                id: 'financial-nasdaq',
                name: 'NASDAQ',
                hidden: false,
                properties: { stock_exc_code: 'USD', market: 'US', internal_: 'hidden' },
            },
        ],
    };
    const cashAccount: bkper.Account = {
        id: 'financial-cash',
        name: 'Cash',
        type: AccountType.ASSET,
        properties: {},
    };

    return {
        id: 'financial-transaction-1',
        posted: true,
        checked: true,
        date: '2024-01-02',
        dateValue: 20240102,
        amount: '100',
        description: 'ACME trade',
        creditAccount: side === 'PURCHASE' ? cashAccount : instrumentAccount,
        debitAccount: side === 'PURCHASE' ? instrumentAccount : cashAccount,
        properties: {
            quantity: '10',
            price_hist: '-20',
            trade_exc_rate: '1.5',
            trade_exc_rate_hist: '1.25',
            order: '7',
            ...properties,
        },
        ...overrides,
    };
}

function createEvent(transaction: bkper.Transaction, agentId = 'user'): bkper.Event {
    return {
        type: 'TRANSACTION_CHECKED',
        bookId: 'financial',
        user: { username: 'tester' },
        agent: { id: agentId },
        data: { object: { transaction } },
    };
}

function createContext(book: Book): AppContext {
    const bkper = new Bkper();
    bkper.getBook = async () => book;
    return new AppContext(bkper, { ASSETS: { fetch } });
}

function returnTransactions(
    book: Book,
    transactions: bkper.Transaction[],
    queries: string[] = []
): void {
    book.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(book, { items: transactions });
    };
}

function createUpdateGate(): UpdateGate {
    let release: () => void = () => undefined;
    let signalStarted: () => void = () => undefined;
    waitForAccountUpdate = new Promise<void>(resolve => {
        release = resolve;
    });
    const started = new Promise<void>(resolve => {
        signalStarted = resolve;
    });
    signalAccountUpdateStarted = signalStarted;
    return { started, release };
}

function expectCompleteMovement(transaction: bkper.Transaction): void {
    expect(transaction.amount).toBeTruthy();
    expect(transaction.amount).not.toBe('0');
    expect(transaction.creditAccount?.name).toBeTruthy();
    expect(transaction.debitAccount?.name).toBeTruthy();
}

describe('legacy checked quantity mirroring', () => {
    test('creates Portfolio resources and mirrors a purchase from Buy to the instrument', async () => {
        const { financialBook, portfolioBook } = createBooks();
        const queries: string[] = [];
        returnTransactions(portfolioBook, [], queries);

        const result = await new EventHandlerTransactionChecked(
            createContext(financialBook)
        ).handleEvent(createEvent(createFinancialTransaction('PURCHASE')));

        expect(queries).toEqual(['remoteId:financial-transaction-1']);
        expect(boundary.createdGroups.map(group => group.json())).toEqual([
            expect.objectContaining({
                name: 'NASDAQ',
                hidden: false,
                properties: { stock_exc_code: 'USD', market: 'US' },
            }),
        ]);
        expect(boundary.createdAccounts.map(account => account.json())).toEqual([
            expect.objectContaining({
                name: 'ACME',
                type: AccountType.ASSET,
                archived: false,
                properties: { ticker: 'ACME' },
                groups: [expect.objectContaining({ name: 'NASDAQ' })],
            }),
            expect.objectContaining({ name: 'Buy', type: AccountType.INCOMING }),
        ]);
        expect(boundary.postedTransactions).toHaveLength(1);
        const movement = boundary.postedTransactions[0];
        expectCompleteMovement(movement);
        expect(movement).toEqual(
            expect.objectContaining({
                amount: '10',
                date: '2024-01-02',
                description: 'ACME trade',
                remoteIds: ['financial-transaction-1'],
                creditAccount: expect.objectContaining({ name: 'Buy' }),
                debitAccount: expect.objectContaining({ name: 'ACME' }),
                properties: {
                    purchase_price: '10',
                    purchase_price_hist: '20',
                    trade_exc_rate: '1.5',
                    trade_exc_rate_hist: '1.25',
                    order: '7',
                    original_quantity: '10',
                    original_amount: '100',
                    stock_exc_code: 'USD',
                },
            })
        );
        expect(result).toEqual({
            result: [
                "BUY: <a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: 2024-01-02 10 Buy ACME ACME trade",
            ],
        });
    });

    test('mirrors a sale from the instrument to Sell and awaits its rebuild update', async () => {
        const { financialBook, portfolioBook } = createBooks();
        const stockAccount = registerAccount(portfolioBook, 'ACME', AccountType.ASSET, {
            realized_date: '2024-01-03',
        });
        returnTransactions(portfolioBook, []);
        const updateGate = createUpdateGate();
        const handlerPromise = new EventHandlerTransactionChecked(
            createContext(financialBook)
        ).handleEvent(createEvent(createFinancialTransaction('SALE')));

        await updateGate.started;
        let settled = false;
        void handlerPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        updateGate.release();
        const result = await handlerPromise;

        expect(boundary.createdAccounts.map(account => account.json())).toEqual([
            expect.objectContaining({ name: 'Sell', type: AccountType.OUTGOING }),
        ]);
        expect(boundary.updatedAccounts).toEqual([
            expect.objectContaining({
                id: stockAccount.getId(),
                properties: { realized_date: '2024-01-03', needs_rebuild: 'TRUE' },
            }),
        ]);
        expect(boundary.postedTransactions).toHaveLength(1);
        const movement = boundary.postedTransactions[0];
        expectCompleteMovement(movement);
        expect(movement).toEqual(
            expect.objectContaining({
                amount: '10',
                creditAccount: expect.objectContaining({ name: 'ACME' }),
                debitAccount: expect.objectContaining({ name: 'Sell' }),
                properties: expect.objectContaining({
                    sale_price: '10',
                    sale_price_hist: '20',
                }),
            })
        );
        expect(result.result).toEqual([
            "SELL: <a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: 2024-01-02 10 ACME Sell ACME trade",
        ]);
    });

    test('returns the existing mirrored movement without creating a duplicate', async () => {
        const { financialBook, portfolioBook } = createBooks();
        registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        registerAccount(portfolioBook, 'ACME', AccountType.ASSET);
        const existingTransaction: bkper.Transaction = {
            id: 'portfolio-transaction-1',
            posted: true,
            date: '2024-01-02',
            amount: '10',
            description: 'ACME trade',
            creditAccount: { id: 'buy', name: 'Buy', type: AccountType.INCOMING },
            debitAccount: { id: 'acme', name: 'ACME', type: AccountType.ASSET },
            properties: {},
            remoteIds: ['financial-transaction-1'],
        };
        returnTransactions(portfolioBook, [existingTransaction]);

        const result = await new EventHandlerTransactionChecked(
            createContext(financialBook)
        ).handleEvent(createEvent(createFinancialTransaction('PURCHASE')));

        expect(result).toEqual({
            result: [
                "FOUND: <a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: 2024-01-02 10 Buy ACME ACME trade",
            ],
        });
        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.createdGroups).toEqual([]);
        expect(boundary.updatedAccounts).toEqual([]);
        expect(boundary.postedTransactions).toEqual([]);
    });

    test('retries and awaits a missing rebuild flag when the mirror already exists', async () => {
        const { financialBook, portfolioBook } = createBooks();
        registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        const stockAccount = registerAccount(portfolioBook, 'ACME', AccountType.ASSET, {
            realized_date: '2024-01-03',
        });
        const existingTransaction: bkper.Transaction = {
            id: 'portfolio-transaction-1',
            posted: true,
            date: '2024-01-02',
            amount: '10',
            description: 'ACME trade',
            creditAccount: { id: 'buy', name: 'Buy', type: AccountType.INCOMING },
            debitAccount: { id: 'acme', name: 'ACME', type: AccountType.ASSET },
            properties: {},
            remoteIds: ['financial-transaction-1'],
        };
        returnTransactions(portfolioBook, [existingTransaction]);
        const updateGate = createUpdateGate();
        const handlerPromise = new EventHandlerTransactionChecked(
            createContext(financialBook)
        ).handleEvent(createEvent(createFinancialTransaction('PURCHASE')));

        const firstCompleted = await Promise.race([
            updateGate.started.then(() => 'update-started'),
            handlerPromise.then(() => 'handler-completed'),
        ]);
        expect(firstCompleted).toBe('update-started');
        let settled = false;
        void handlerPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        updateGate.release();
        const result = await handlerPromise;

        expect(boundary.updatedAccounts).toEqual([
            expect.objectContaining({
                id: stockAccount.getId(),
                properties: { realized_date: '2024-01-03', needs_rebuild: 'TRUE' },
            }),
        ]);
        expect(boundary.postedTransactions).toEqual([]);
        expect(result.result).toEqual([
            "FOUND: <a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: 2024-01-02 10 Buy ACME ACME trade",
        ]);
    });

    test('preserves unposted, unmatched exchange, missing, and zero quantity no-op paths', async () => {
        const cases: { bookProperties?: Record<string, string>; transaction: bkper.Transaction }[] =
            [
                { transaction: createFinancialTransaction('PURCHASE', { posted: false }) },
                {
                    bookProperties: { exc_code: 'EUR' },
                    transaction: createFinancialTransaction('PURCHASE'),
                },
                {
                    transaction: createFinancialTransaction('PURCHASE', {
                        properties: { quantity: '' },
                    }),
                },
                {
                    transaction: createFinancialTransaction('PURCHASE', {}, { quantity: '0' }),
                },
                {
                    transaction: createFinancialTransaction('PURCHASE', {
                        debitAccount: {
                            id: 'unsupported',
                            name: 'Unsupported',
                            type: AccountType.ASSET,
                            properties: {},
                            groups: [],
                        },
                    }),
                },
            ];

        for (const testCase of cases) {
            const { financialBook, portfolioBook } = createBooks(testCase.bookProperties);
            returnTransactions(portfolioBook, []);
            const result = await new EventHandlerTransactionChecked(
                createContext(financialBook)
            ).handleEvent(createEvent(testCase.transaction));
            expect(result).toEqual({ result: false });
        }

        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.createdGroups).toEqual([]);
        expect(boundary.updatedAccounts).toEqual([]);
        expect(boundary.postedTransactions).toEqual([]);
    });
});

describe('legacy checked rebuild interception', () => {
    test('flags an externally changed Portfolio instrument and awaits the update', async () => {
        const portfolioBook = new Book({
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        });
        configurePortfolioLookups(portfolioBook);
        registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        const stockAccount = registerAccount(portfolioBook, 'ACME', AccountType.ASSET);
        const stockTransaction = new Transaction(portfolioBook, {
            id: 'portfolio-transaction-1',
            posted: true,
            creditAccount: { id: 'buy', name: 'Buy', type: AccountType.INCOMING },
            debitAccount: { id: 'acme', name: 'ACME', type: AccountType.ASSET },
            properties: {},
        });
        portfolioBook.getTransaction = async () => stockTransaction;
        const updateGate = createUpdateGate();
        const interceptorPromise = new InterceptorFlagRebuild(
            createContext(portfolioBook)
        ).intercept(portfolioBook, createEvent(stockTransaction.json()));

        await updateGate.started;
        let settled = false;
        void interceptorPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        updateGate.release();
        const result = await interceptorPromise;

        expect(stockAccount.getProperty('needs_rebuild')).toBe('TRUE');
        expect(boundary.updatedAccounts).toHaveLength(1);
        expect(result).toEqual({
            warning: 'Flagging account ACME for rebuild',
            result: 'Flagging account ACME for rebuild',
        });
    });

    test('does not flag changes generated by Portfolio Bot', async () => {
        const portfolioBook = new Book({
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        });
        let transactionLoads = 0;
        portfolioBook.getTransaction = async () => {
            transactionLoads += 1;
            return undefined;
        };

        const result = await new InterceptorFlagRebuild(createContext(portfolioBook)).intercept(
            portfolioBook,
            createEvent(createFinancialTransaction('PURCHASE'), 'stock-bot')
        );

        expect(result).toEqual({ result: false });
        expect(transactionLoads).toBe(0);
        expect(boundary.updatedAccounts).toEqual([]);
    });
});
