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
import { EventHandlerTransactionChecked } from '../../src/events/handlers/EventHandlerTransactionChecked.js';
import { InterceptorFlagRebuild } from '../../src/events/interceptors/InterceptorFlagRebuild.js';
import { AppContext } from '../../src/shared/app-context.js';

const originalAccountCreate = Account.prototype.create;
const originalAccountUpdate = Account.prototype.update;
const originalGroupCreate = Group.prototype.create;
const originalTransactionPost = Transaction.prototype.post;
const originalBookGetAccount = Book.prototype.getAccount;
const originalBookGetGroup = Book.prototype.getGroup;
const originalBookListTransactions = Book.prototype.listTransactions;
const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;

interface RecordingBoundary {
    createdAccounts: bkper.Account[];
    createdGroups: bkper.Group[];
    updatedAccounts: bkper.Account[];
    postedTransactions: bkper.Transaction[];
    operations: string[];
}

interface UpdateGate {
    started: Promise<void>;
    release: () => void;
}

let boundary: RecordingBoundary;
let accountsByBook: Map<string, Map<string, Account>>;
let groupsByBook: Map<string, Map<string, Group>>;
let transactionsByBook: Map<string, bkper.Transaction[]>;
let queriesByBook: Map<string, string[]>;
let waitForAccountUpdate: Promise<void> | null;
let signalAccountUpdateStarted: (() => void) | null;

beforeEach(() => {
    boundary = {
        createdAccounts: [],
        createdGroups: [],
        updatedAccounts: [],
        postedTransactions: [],
        operations: [],
    };
    accountsByBook = new Map();
    groupsByBook = new Map();
    transactionsByBook = new Map();
    queriesByBook = new Map();
    waitForAccountUpdate = null;
    signalAccountUpdateStarted = null;
    console.time = () => undefined;
    console.timeEnd = () => undefined;

    Book.prototype.getAccount = async function (idOrName?: string): Promise<Account | undefined> {
        const account = getAccountMap(this.getId()).get(idOrName ?? '');
        if (account) {
            return account;
        }
        throw new BkperError(404, `Account ${idOrName} not found`, 'notFound');
    };

    Book.prototype.getGroup = async function (idOrName?: string): Promise<Group | undefined> {
        const group = getGroupMap(this.getId()).get(idOrName ?? '');
        if (group) {
            return group;
        }
        throw new BkperError(404, `Group ${idOrName} not found`, 'notFound');
    };

    Book.prototype.listTransactions = async function (query?: string): Promise<TransactionList> {
        const queries = queriesByBook.get(this.getId()) ?? [];
        queries.push(query ?? '');
        queriesByBook.set(this.getId(), queries);
        return new TransactionList(this, { items: transactionsByBook.get(this.getId()) ?? [] });
    };

    Account.prototype.create = async function (): Promise<Account> {
        const book = getResourceBook(this);
        const name = this.getName();
        const persisted = new Account(book, {
            ...this.json(),
            id: `created-${name?.toLowerCase().replaceAll(' ', '-')}`,
        });
        boundary.createdAccounts.push(persisted.json());
        boundary.operations.push(`create-account:${name}`);
        if (name) {
            registerAccountObject(book.getId(), persisted);
        }
        return persisted;
    };

    Account.prototype.update = async function (): Promise<Account> {
        boundary.updatedAccounts.push(this.json());
        boundary.operations.push(`update-account:${this.getName()}`);
        signalAccountUpdateStarted?.();
        if (waitForAccountUpdate) {
            await waitForAccountUpdate;
        }
        return this;
    };

    Group.prototype.create = async function (): Promise<Group> {
        const book = getResourceBook(this);
        const name = this.getName();
        const persisted = new Group(book, {
            ...this.json(),
            id: `created-${name?.toLowerCase().replaceAll(' ', '-')}`,
        });
        boundary.createdGroups.push(persisted.json());
        boundary.operations.push(`create-group:${name}`);
        if (name) {
            registerGroupObject(book.getId(), persisted);
        }
        return persisted;
    };

    Transaction.prototype.post = async function (): Promise<Transaction> {
        boundary.postedTransactions.push(this.json());
        boundary.operations.push('post-transaction');
        return this;
    };
});

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
    Account.prototype.update = originalAccountUpdate;
    Group.prototype.create = originalGroupCreate;
    Transaction.prototype.post = originalTransactionPost;
    Book.prototype.getAccount = originalBookGetAccount;
    Book.prototype.getGroup = originalBookGetGroup;
    Book.prototype.listTransactions = originalBookListTransactions;
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

function registerAccountObject(bookId: string, account: Account): void {
    const accountMap = getAccountMap(bookId);
    const name = account.getName();
    const id = account.getId();
    if (name) {
        accountMap.set(name, account);
    }
    if (id) {
        accountMap.set(id, account);
    }
}

function registerGroupObject(bookId: string, group: Group): void {
    const groupMap = getGroupMap(bookId);
    const name = group.getName();
    const id = group.getId();
    if (name) {
        groupMap.set(name, group);
    }
    if (id) {
        groupMap.set(id, group);
    }
}

function registerAccount(
    bookId: string,
    name: string,
    type: AccountType,
    properties: Record<string, string> = {},
    archived = false
): Account {
    const account = new Account(new Book({ id: bookId, name: bookId }), {
        id: `${bookId}-${name.toLowerCase().replaceAll(' ', '-')}`,
        name,
        type,
        properties,
        archived,
    });
    registerAccountObject(bookId, account);
    return account;
}

function registerGroup(
    bookId: string,
    name: string,
    properties: Record<string, string> = {}
): Group {
    const group = new Group(new Book({ id: bookId, name: bookId }), {
        id: `${bookId}-${name.toLowerCase().replaceAll(' ', '-')}`,
        name,
        properties,
    });
    registerGroupObject(bookId, group);
    return group;
}

function createFinancialBook(properties: Record<string, string> = { exc_code: 'USD' }): Book {
    return new Book({
        id: 'financial',
        name: 'Financial',
        fractionDigits: 2,
        properties,
        collection: {
            books: [
                {
                    id: 'financial',
                    name: 'Financial',
                    fractionDigits: 2,
                    properties,
                },
                {
                    id: 'inventory',
                    name: 'Inventory',
                    fractionDigits: 4,
                    properties: { inventory_book: 'true' },
                },
            ],
        },
    });
}

function createFinancialAccount(name: string): bkper.Account {
    return {
        id: `financial-${name.toLowerCase().replaceAll(' ', '-')}`,
        name,
        type: AccountType.ASSET,
        archived: false,
        properties: { sku: name.toUpperCase(), internal_: 'preserved' },
        groups: [
            {
                id: 'financial-clothing',
                name: 'Clothing',
                hidden: false,
                parent: { id: 'financial-assets', name: 'Assets' },
                properties: { exc_code: 'USD', aisle: '2', internal_: 'preserved' },
            },
        ],
    };
}

function createPurchase(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'financial-transaction-1',
        posted: true,
        checked: true,
        date: '2024-01-02',
        dateValue: 20240102,
        amount: '125.50',
        description: 'Shirt purchase',
        creditAccount: {
            id: 'financial-cash',
            name: 'Cash',
            type: AccountType.ASSET,
        },
        debitAccount: createFinancialAccount('Shirts'),
        properties: {
            quantity: '10',
            purchase_invoice: 'PI-1',
            purchase_code: 'PO-1',
            order: '7',
        },
        ...overrides,
    };
}

function createSale(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'financial-transaction-2',
        posted: true,
        checked: true,
        date: '2024-01-03',
        dateValue: 20240103,
        amount: '75',
        description: 'Shirt sale',
        creditAccount: createFinancialAccount('Shirts'),
        debitAccount: {
            id: 'financial-cash',
            name: 'Cash',
            type: AccountType.ASSET,
        },
        properties: {
            quantity: '3',
            sale_invoice: 'SI-1',
            good: 'Shirts',
            order: '8',
        },
        ...overrides,
    };
}

function createCreditNote(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'financial-transaction-3',
        posted: true,
        checked: true,
        date: '2024-01-04',
        dateValue: 20240104,
        amount: '20',
        description: 'Shirt credit note',
        creditAccount: createFinancialAccount('Shirts'),
        debitAccount: {
            id: 'financial-return',
            name: 'Supplier return',
            type: AccountType.ASSET,
            groups: [{ properties: { exc_code: 'USD' } }],
        },
        properties: {
            quantity: '2',
            credit_note: 'CN-1',
            purchase_code: 'PO-1',
            order: '9',
        },
        ...overrides,
    };
}

function registerFinancialGood(transaction: bkper.Transaction): void {
    const financialGood = new Account(
        new Book({ id: 'financial', name: 'Financial' }),
        transaction.creditAccount
    );
    financialGood.getGroups = async () => [
        new Group(new Book({ id: 'financial', name: 'Financial' }), {
            name: 'Clothing',
            properties: { exc_code: 'USD' },
        }),
    ];
    registerAccountObject('financial', financialGood);
}

function createEvent(
    financialBook: Book,
    transaction: bkper.Transaction,
    agentId = 'user'
): bkper.Event {
    return {
        type: 'TRANSACTION_CHECKED',
        bookId: financialBook.getId(),
        book: financialBook.json(),
        user: { username: 'tester' },
        agent: { id: agentId },
        data: { object: { transaction } },
    };
}

function createContext(): AppContext {
    return new AppContext(new Bkper(), { ASSETS: { fetch } });
}

function setInventoryTransactions(transactions: bkper.Transaction[]): void {
    transactionsByBook.set('inventory', transactions);
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

describe('legacy checked Inventory quantity mirroring', () => {
    test('creates direct Group and Account resources before posting a complete Buy to item purchase', async () => {
        const financialBook = createFinancialBook();
        const transaction = createPurchase();
        registerGroup('inventory', 'Assets');
        setInventoryTransactions([]);

        const result = await new EventHandlerTransactionChecked(createContext()).handleEvent(
            createEvent(financialBook, transaction)
        );

        expect(queriesByBook.get('inventory')).toEqual(['remoteId:financial-transaction-1']);
        expect(boundary.createdGroups).toEqual([
            expect.objectContaining({
                name: 'Clothing',
                hidden: false,
                parent: expect.objectContaining({ name: 'Assets' }),
                properties: { exc_code: 'USD', aisle: '2', internal_: 'preserved' },
            }),
        ]);
        expect(boundary.createdAccounts).toEqual([
            expect.objectContaining({
                name: 'Shirts',
                type: AccountType.ASSET,
                archived: false,
                properties: { sku: 'SHIRTS', internal_: 'preserved' },
                groups: [expect.objectContaining({ name: 'Clothing' })],
            }),
            expect.objectContaining({ name: 'Buy', type: AccountType.INCOMING }),
        ]);
        expect(boundary.operations).toEqual([
            'create-group:Clothing',
            'create-account:Shirts',
            'create-account:Buy',
            'post-transaction',
        ]);
        expect(boundary.postedTransactions).toHaveLength(1);
        const movement = boundary.postedTransactions[0]!;
        expectCompleteMovement(movement);
        expect(movement).toEqual(
            expect.objectContaining({
                amount: '10',
                date: '2024-01-02',
                description: 'Shirt purchase',
                remoteIds: ['financial-transaction-1'],
                creditAccount: expect.objectContaining({ name: 'Buy' }),
                debitAccount: expect.objectContaining({ name: 'Shirts' }),
                properties: {
                    purchase_code: 'PO-1',
                    original_quantity: '10',
                    good_purchase_cost: '125.5',
                    order: '7',
                    exc_code: 'USD',
                    total_cost: '125.5',
                },
            })
        );
        expect(result).toEqual({
            result: [
                "BUY: <a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: 2024-01-02 10 Buy Shirts Shirt purchase",
            ],
        });
    });

    test('creates missing item and Sell Accounts before posting a complete item to Sell movement', async () => {
        const financialBook = createFinancialBook();
        const transaction = createSale();
        registerFinancialGood(transaction);
        setInventoryTransactions([]);

        const result = await new EventHandlerTransactionChecked(createContext()).handleEvent(
            createEvent(financialBook, transaction)
        );

        expect(boundary.createdAccounts).toEqual([
            expect.objectContaining({ name: 'Shirts', type: AccountType.ASSET }),
            expect.objectContaining({ name: 'Sell', type: AccountType.OUTGOING }),
        ]);
        expect(boundary.postedTransactions).toHaveLength(1);
        const movement = boundary.postedTransactions[0]!;
        expectCompleteMovement(movement);
        expect(movement).toEqual(
            expect.objectContaining({
                amount: '3',
                creditAccount: expect.objectContaining({ name: 'Shirts' }),
                debitAccount: expect.objectContaining({ name: 'Sell' }),
                properties: {
                    sale_invoice: 'SI-1',
                    order: '8',
                    sale_amount: '75',
                    exc_code: 'USD',
                },
            })
        );
        expect(result).toEqual({
            result: [
                "SELL: <a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: 2024-01-03 3 Shirts Shirts Shirt sale",
            ],
        });
    });

    test('posts a quantity-bearing credit note as the accepted reverse item to Buy movement', async () => {
        const financialBook = createFinancialBook();
        const transaction = createCreditNote();
        registerGroup('inventory', 'Assets');
        setInventoryTransactions([]);

        const result = await new EventHandlerTransactionChecked(createContext()).handleEvent(
            createEvent(financialBook, transaction)
        );

        expect(boundary.postedTransactions).toHaveLength(1);
        const movement = boundary.postedTransactions[0]!;
        expectCompleteMovement(movement);
        expect(movement).toEqual(
            expect.objectContaining({
                amount: '2',
                creditAccount: expect.objectContaining({ name: 'Shirts' }),
                debitAccount: expect.objectContaining({ name: 'Buy' }),
                properties: {
                    credit_note: 'CN-1',
                    purchase_code: 'PO-1',
                    order: '9',
                    exc_code: 'USD',
                },
            })
        );
        expect(result).toEqual({
            result: [
                "CREDIT: <a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: 2024-01-04 2 Shirts Shirts Shirt credit note",
            ],
        });
    });

    test('returns the first existing remote-id mirror without creating a duplicate', async () => {
        const financialBook = createFinancialBook();
        const buy = registerAccount('inventory', 'Buy', AccountType.INCOMING);
        const item = registerAccount('inventory', 'Shirts', AccountType.ASSET);
        const existing: bkper.Transaction = {
            id: 'inventory-transaction-1',
            posted: true,
            date: '2024-01-02',
            amount: '10',
            description: 'Shirt purchase',
            creditAccount: buy.json(),
            debitAccount: item.json(),
            remoteIds: ['financial-transaction-1'],
        };
        setInventoryTransactions([existing]);

        const result = await new EventHandlerTransactionChecked(createContext()).handleEvent(
            createEvent(financialBook, createPurchase())
        );

        expect(result).toEqual({
            result: [
                "FOUND: <a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a> 2024-01-02 10 Buy Shirts Shirt purchase",
            ],
        });
        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.createdGroups).toEqual([]);
        expect(boundary.updatedAccounts).toEqual([]);
        expect(boundary.postedTransactions).toEqual([]);
    });

    test('synchronizes an existing purchase item before creating and posting the mirror', async () => {
        const financialBook = createFinancialBook();
        const existing = registerAccount(
            'inventory',
            'Shirts',
            AccountType.ASSET,
            {
                stale: 'true',
            },
            true
        );
        registerGroup('inventory', 'Assets');
        setInventoryTransactions([]);

        await new EventHandlerTransactionChecked(createContext()).handleEvent(
            createEvent(financialBook, createPurchase())
        );

        expect(boundary.createdGroups).toHaveLength(1);
        expect(boundary.updatedAccounts).toEqual([
            expect.objectContaining({
                id: existing.getId(),
                archived: false,
                properties: { sku: 'SHIRTS', internal_: 'preserved' },
                groups: [expect.objectContaining({ name: 'Clothing' })],
            }),
        ]);
        expect(boundary.operations).toEqual([
            'create-group:Clothing',
            'update-account:Shirts',
            'create-account:Buy',
            'post-transaction',
        ]);
    });

    test('awaits a historical movement rebuild flag after posting and returns the legacy warning', async () => {
        const financialBook = createFinancialBook();
        registerFinancialGood(createSale());
        const item = registerAccount('inventory', 'Shirts', AccountType.ASSET, {
            cogs_calc_date: '2024-01-03',
        });
        setInventoryTransactions([]);
        const updateGate = createUpdateGate();

        const handlerPromise = new EventHandlerTransactionChecked(createContext()).handleEvent(
            createEvent(financialBook, createSale({ date: '2024-01-02', dateValue: 20240102 }))
        );
        await updateGate.started;
        let settled = false;
        void handlerPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        updateGate.release();
        const result = await handlerPromise;

        expect(boundary.operations).toEqual([
            'create-account:Sell',
            'post-transaction',
            'update-account:Shirts',
        ]);
        expect(boundary.updatedAccounts).toEqual([
            expect.objectContaining({
                id: item.getId(),
                properties: { cogs_calc_date: '2024-01-03', needs_rebuild: 'TRUE' },
            }),
        ]);
        expect(result).toEqual({
            result: [
                "SELL: <a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: 2024-01-02 3 Shirts Shirts Shirt sale",
            ],
            warning:
                'WARNING: Transaction date is before the last COGS calculation date. Flagging account Shirts for rebuild',
        });
    });

    test('keeps missing, zero, incomplete, unsupported, and mismatched transactions non-balance-affecting', async () => {
        const cases: { book?: Book; transaction: bkper.Transaction }[] = [
            { transaction: createPurchase({ properties: { purchase_invoice: 'PI-1' } }) },
            {
                transaction: createPurchase({
                    properties: { quantity: '0', purchase_invoice: 'PI-1' },
                }),
            },
            {
                transaction: createPurchase({
                    debitAccount: undefined,
                }),
            },
            {
                transaction: createPurchase({
                    properties: { quantity: '1' },
                }),
            },
            {
                book: createFinancialBook({ exc_code: 'EUR' }),
                transaction: createPurchase(),
            },
        ];

        for (const testCase of cases) {
            setInventoryTransactions([]);
            const financialBook = testCase.book ?? createFinancialBook();
            const result = await new EventHandlerTransactionChecked(createContext()).handleEvent(
                createEvent(financialBook, testCase.transaction)
            );
            expect(result).toEqual({ result: false });
        }

        expect(boundary.createdAccounts).toEqual([]);
        expect(boundary.createdGroups).toEqual([]);
        expect(boundary.updatedAccounts).toEqual([]);
        expect(boundary.postedTransactions).toEqual([]);
    });
});

describe('legacy checked Inventory rebuild interception', () => {
    test('flags an externally checked Inventory item and awaits the Account update', async () => {
        const inventoryBook = new Book({
            id: 'inventory',
            name: 'Inventory',
            properties: { inventory_book: 'true' },
        });
        const buy = registerAccount('inventory', 'Buy', AccountType.INCOMING);
        const item = registerAccount('inventory', 'Shirts', AccountType.ASSET);
        transactionsByBook.set('inventory', [
            {
                id: 'inventory-transaction-1',
                posted: true,
                creditAccount: buy.json(),
                debitAccount: item.json(),
            },
        ]);
        const updateGate = createUpdateGate();
        const event: bkper.Event = {
            type: 'TRANSACTION_CHECKED',
            agent: { id: 'user' },
            data: {
                object: { transaction: { id: 'inventory-transaction-1' } },
            },
        };

        const interceptorPromise = new InterceptorFlagRebuild(createContext()).intercept(
            inventoryBook,
            event
        );
        await updateGate.started;
        let settled = false;
        void interceptorPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        updateGate.release();
        const result = await interceptorPromise;

        expect(queriesByBook.get('inventory')).toEqual(['inventory-transaction-1']);
        expect(item.getProperty('needs_rebuild')).toBe('TRUE');
        expect(boundary.updatedAccounts).toHaveLength(1);
        expect(result).toEqual({
            warning: 'Flagging account Shirts for rebuild',
            result: 'Flagging account Shirts for rebuild',
        });
    });

    test('ignores Inventory Bot activity and missing event objects without loading a Transaction', async () => {
        const inventoryBook = new Book({
            id: 'inventory',
            name: 'Inventory',
            properties: { inventory_book: 'true' },
        });
        const interceptor = new InterceptorFlagRebuild(createContext());

        expect(
            await interceptor.intercept(inventoryBook, {
                type: 'TRANSACTION_CHECKED',
                agent: { id: 'inventory-bot' },
                data: { object: { transaction: { id: 'inventory-transaction-1' } } },
            })
        ).toEqual({ result: false });
        expect(
            await interceptor.intercept(inventoryBook, {
                type: 'TRANSACTION_CHECKED',
                agent: { id: 'user' },
                data: {},
            })
        ).toEqual({ result: false });
        expect(queriesByBook.get('inventory')).toBeUndefined();
        expect(boundary.updatedAccounts).toEqual([]);
    });
});
