import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    Account,
    AccountType,
    Bkper,
    BkperError,
    Book,
    Transaction,
    TransactionList,
} from 'bkper-js';
import { InterceptorOrderProcessorDeleteFinancial } from '../../src/events/interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { AppContext } from '../../src/shared/app-context.js';

const originalAccountCreate = Account.prototype.create;
const originalAccountUpdate = Account.prototype.update;
const originalTransactionPost = Transaction.prototype.post;
const originalTransactionTrash = Transaction.prototype.trash;
const originalTransactionUncheck = Transaction.prototype.uncheck;

interface BooksFixture {
    financialBook: Book;
    inventoryBook: Book;
}

let accountsByBook: Map<string, Map<string, Account>>;
let fixturesByQuery: Map<string, bkper.Transaction[]>;
let operations: string[];
let queries: string[];
let trashFailure: { error: Error; transactionId: string } | undefined;

beforeEach(() => {
    accountsByBook = new Map();
    fixturesByQuery = new Map();
    operations = [];
    queries = [];
    trashFailure = undefined;

    Account.prototype.create = async function (): Promise<Account> {
        throw new Error(`Deletion must not create Account ${this.getName()}`);
    };
    Account.prototype.update = async function (): Promise<Account> {
        operations.push(`update-account:${this.getName()}`);
        return this;
    };
    Transaction.prototype.post = async function (): Promise<Transaction> {
        throw new Error(`Deletion must not post Transaction ${this.getId()}`);
    };
    Transaction.prototype.uncheck = async function (): Promise<Transaction> {
        operations.push(`uncheck:${this.getId()}`);
        this.setChecked(false);
        return this;
    };
    Transaction.prototype.trash = async function (): Promise<Transaction> {
        operations.push(`trash:${this.getId()}`);
        const failure = trashFailure;
        if (failure && failure.transactionId === this.getId()) {
            throw failure.error;
        }
        return this;
    };
});

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
    Account.prototype.update = originalAccountUpdate;
    Transaction.prototype.post = originalTransactionPost;
    Transaction.prototype.trash = originalTransactionTrash;
    Transaction.prototype.uncheck = originalTransactionUncheck;
});

function createBooks(): BooksFixture {
    const collectionPayload: bkper.Collection = {
        books: [
            {
                id: 'financial',
                name: 'Financial',
                fractionDigits: 2,
                datePattern: 'yyyy-MM-dd',
                timeZone: 'UTC',
                properties: { exc_code: 'USD' },
            },
            {
                id: 'inventory',
                name: 'Inventory',
                fractionDigits: 0,
                datePattern: 'yyyy-MM-dd',
                timeZone: 'UTC',
                properties: { inventory_book: 'true' },
            },
        ],
    };
    const financialBook = new Book({
        ...collectionPayload.books![0],
        collection: collectionPayload,
    });
    const inventoryBook = new Book({
        ...collectionPayload.books![1],
        collection: collectionPayload,
    });
    const books = [financialBook, inventoryBook];

    for (const book of books) {
        book.getCollection()!.getBooks = () => books;
        book.getAccount = async idOrName => {
            const account = getAccountMap(book).get(idOrName ?? '');
            if (account) {
                return account;
            }
            throw new BkperError(404, `Account ${idOrName} not found`, 'notFound');
        };
        book.listTransactions = async query => {
            queries.push(`${book.getId()}:${query ?? ''}`);
            return new TransactionList(book, {
                items: fixturesByQuery.get(`${book.getId()}:${query ?? ''}`) ?? [],
            });
        };
    }

    return { financialBook, inventoryBook };
}

function getAccountMap(book: Book): Map<string, Account> {
    let accounts = accountsByBook.get(book.getId());
    if (!accounts) {
        accounts = new Map();
        accountsByBook.set(book.getId(), accounts);
    }
    return accounts;
}

function registerAccount(
    book: Book,
    name: string,
    type: AccountType,
    properties: Record<string, string> = {}
): Account {
    const account = new Account(book, {
        id: `${book.getId()}-${name.toLowerCase().replaceAll(' ', '-')}`,
        name,
        type,
        properties,
    });
    const accountMap = getAccountMap(book);
    accountMap.set(account.getId()!, account);
    accountMap.set(name, account);
    return account;
}

function createTransaction(
    id: string,
    creditAccount: Account,
    debitAccount: Account,
    overrides: Partial<bkper.Transaction> = {}
): bkper.Transaction {
    return {
        id,
        posted: true,
        checked: true,
        date: '2024-01-02',
        dateFormatted: '2024-01-02',
        dateValue: 20240102,
        amount: '10',
        description: id,
        creditAccount: creditAccount.json(),
        debitAccount: debitAccount.json(),
        properties: {},
        ...overrides,
    };
}

function registerList(book: Book, query: string, items: bkper.Transaction[]): void {
    fixturesByQuery.set(`${book.getId()}:${query}`, items);
}

function createEvent(transaction?: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_DELETED',
        data: transaction === undefined ? {} : { object: { transaction } },
    };
}

function createInterceptor(financialBook: Book): InterceptorOrderProcessorDeleteFinancial {
    const bkper = new Bkper();
    bkper.getBook = async () => financialBook;
    return new InterceptorOrderProcessorDeleteFinancial(
        new AppContext(bkper, { ASSETS: { fetch } })
    );
}

describe('legacy Financial Book deletion behavior', () => {
    test('deletes a root purchase mirror, its splits, linked COGS, then flags rebuild', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const payable = registerAccount(financialBook, 'Supplier', AccountType.LIABILITY);
        const financialGood = registerAccount(financialBook, 'T-shirts', AccountType.OUTGOING);
        const buy = registerAccount(inventoryBook, 'Buy', AccountType.INCOMING);
        const inventoryGood = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET, {
            cogs_calc_date: '2024-01-03',
        });
        const cogs = registerAccount(financialBook, 'Cost of goods sold', AccountType.OUTGOING);
        const sourcePurchase = createTransaction('financial-purchase', payable, financialGood, {
            properties: {
                quantity: '10',
                purchase_code: 'PURCHASE-1',
                purchase_invoice: 'PURCHASE-1',
            },
        });
        const inventoryPurchase = createTransaction('inventory-purchase', buy, inventoryGood, {
            properties: { original_quantity: '10' },
        });
        const split = createTransaction('inventory-split', buy, inventoryGood, {
            amount: '4',
            properties: { parent_id: 'inventory-purchase' },
        });
        const linkedCogs = createTransaction('financial-cogs', financialGood, cogs);
        registerList(inventoryBook, 'remoteId:financial-purchase', [inventoryPurchase]);
        registerList(inventoryBook, "account:'T-shirts'", [inventoryPurchase, split]);
        registerList(financialBook, 'remoteId:inventory-purchase', [linkedCogs]);

        const result = await createInterceptor(financialBook).intercept(
            financialBook,
            createEvent(sourcePurchase)
        );

        expect(queries).toEqual([
            'inventory:remoteId:financial-purchase',
            "inventory:account:'T-shirts'",
            'financial:remoteId:inventory-purchase',
        ]);
        expect(operations).toEqual([
            'uncheck:inventory-purchase',
            'trash:inventory-purchase',
            'uncheck:inventory-split',
            'trash:inventory-split',
            'uncheck:financial-cogs',
            'trash:financial-cogs',
            'update-account:T-shirts',
        ]);
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=financial'>Financial</a>: DELETED: 2024-01-02 10 Buy T-shirts inventory-purchase",
            "<a href='https://app.bkper.com/b/#transactions:bookId=financial'>Financial</a>: DELETED: 2024-01-02 4 Buy T-shirts inventory-split",
            "<a href='https://app.bkper.com/b/#transactions:bookId=financial'>Financial</a>: DELETED: 2024-01-02 10 T-shirts Cost of goods sold financial-cogs",
            "<a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: Flagging account for rebuild",
        ]);
    });

    test('deletes a sale mirror then applies the accepted rebuild decision', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const income = registerAccount(financialBook, 'Sales', AccountType.INCOMING);
        const bank = registerAccount(financialBook, 'Bank', AccountType.ASSET);
        const inventoryGood = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET, {
            cogs_calc_date: '2024-01-03',
        });
        const sell = registerAccount(inventoryBook, 'Sell', AccountType.OUTGOING);
        const sourceSale = createTransaction('financial-sale', bank, income, {
            properties: { good: 'T-shirts' },
            debitAccount: { ...income.json(), type: AccountType.INCOMING },
        });
        const inventorySale = createTransaction('inventory-sale', inventoryGood, sell);
        registerList(inventoryBook, 'remoteId:financial-sale', [inventorySale]);
        registerList(inventoryBook, "account:'Sell'", []);
        registerList(financialBook, 'remoteId:inventory-sale', []);

        const result = await createInterceptor(financialBook).intercept(
            financialBook,
            createEvent(sourceSale)
        );

        expect(queries).toEqual([
            'inventory:remoteId:financial-sale',
            'financial:remoteId:inventory-sale',
        ]);
        expect(operations).toEqual([
            'uncheck:inventory-sale',
            'trash:inventory-sale',
            'update-account:T-shirts',
        ]);
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=financial'>Financial</a>: DELETED: 2024-01-02 10 T-shirts Sell inventory-sale",
            "<a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: Flagging account for rebuild",
        ]);
    });

    test('stops sequential linked cleanup at the accepted partial-failure boundary', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const payable = registerAccount(financialBook, 'Supplier', AccountType.LIABILITY);
        const financialGood = registerAccount(financialBook, 'T-shirts', AccountType.OUTGOING);
        const buy = registerAccount(inventoryBook, 'Buy', AccountType.INCOMING);
        const inventoryGood = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET, {
            cogs_calc_date: '2024-01-03',
        });
        const cogs = registerAccount(financialBook, 'Cost of goods sold', AccountType.OUTGOING);
        const sourcePurchase = createTransaction('financial-purchase', payable, financialGood, {
            properties: {
                quantity: '10',
                purchase_code: 'PURCHASE-1',
                purchase_invoice: 'PURCHASE-1',
            },
        });
        const inventoryPurchase = createTransaction('inventory-purchase', buy, inventoryGood, {
            properties: { original_quantity: '10' },
        });
        const split = createTransaction('inventory-split', buy, inventoryGood, {
            properties: { parent_id: 'inventory-purchase' },
        });
        const linkedCogs = createTransaction('financial-cogs', financialGood, cogs);
        registerList(inventoryBook, 'remoteId:financial-purchase', [inventoryPurchase]);
        registerList(inventoryBook, "account:'T-shirts'", [inventoryPurchase, split]);
        registerList(financialBook, 'remoteId:inventory-purchase', [linkedCogs]);
        const expectedError = new Error('Split cleanup failed');
        trashFailure = { error: expectedError, transactionId: 'inventory-split' };

        await expect(
            createInterceptor(financialBook).intercept(financialBook, createEvent(sourcePurchase))
        ).rejects.toBe(expectedError);

        expect(queries).toEqual([
            'inventory:remoteId:financial-purchase',
            "inventory:account:'T-shirts'",
        ]);
        expect(operations).toEqual([
            'uncheck:inventory-purchase',
            'trash:inventory-purchase',
            'uncheck:inventory-split',
            'trash:inventory-split',
        ]);
    });

    test('flags processed purchases after additional-cost or credit deletion in the legacy date range', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const payable = registerAccount(financialBook, 'Supplier', AccountType.LIABILITY);
        const financialGood = registerAccount(financialBook, 'T-shirts', AccountType.ASSET);
        const inventoryGood = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET);
        const buy = registerAccount(inventoryBook, 'Buy', AccountType.INCOMING);
        const additionalCost = createTransaction('additional-cost', financialGood, payable, {
            date: '2024-01-15',
            properties: {
                purchase_code: 'PURCHASE-1',
                purchase_invoice: 'INVOICE-OTHER',
            },
        });
        const processedPurchase = createTransaction('inventory-purchase', buy, inventoryGood, {
            amount: '8',
            properties: {
                purchase_code: 'PURCHASE-1',
                original_quantity: '10',
            },
        });
        registerList(inventoryBook, "account:'T-shirts' after:2023-11-16 before:2024-03-15", [
            processedPurchase,
        ]);

        const result = await createInterceptor(financialBook).intercept(
            financialBook,
            createEvent(additionalCost)
        );

        expect(queries).toEqual([
            "inventory:account:'T-shirts' after:2023-11-16 before:2024-03-15",
        ]);
        expect(operations).toEqual(['update-account:T-shirts']);
        expect(inventoryGood.getProperty('needs_rebuild')).toBe('TRUE');
        expect(result).toEqual({ result: ['Flagging account T-shirts for rebuild'] });
    });

    test('retains hardened generated COGS detection and remote-id lookup order', async () => {
        const cases: Array<{
            description: string;
            properties: Record<string, string>;
        }> = [
            { description: '#COGS Sale', properties: {} },
            { description: '#cost_of_sale Sale', properties: {} },
            { description: 'Calculated by bot', properties: { quantity_sold: '10' } },
        ];

        for (const testCase of cases) {
            const { financialBook, inventoryBook } = createBooks();
            const financialAccount = registerAccount(
                financialBook,
                `Results ${testCase.description}`,
                AccountType.OUTGOING
            );
            const inventoryGood = registerAccount(
                inventoryBook,
                `Good ${testCase.description}`,
                AccountType.ASSET
            );
            const sell = registerAccount(
                inventoryBook,
                `Sell ${testCase.description}`,
                AccountType.OUTGOING
            );
            const inventorySale = createTransaction(
                `inventory-sale-${testCase.description}`,
                inventoryGood,
                sell
            );
            const deletedCogs = createTransaction(
                `cogs-${testCase.description}`,
                financialAccount,
                financialAccount,
                {
                    agentId: 'inventory-bot',
                    description: testCase.description,
                    properties: testCase.properties,
                    remoteIds: ['missing', inventorySale.id!],
                }
            );
            registerList(inventoryBook, 'missing', []);
            registerList(inventoryBook, inventorySale.id!, [inventorySale]);

            const result = await createInterceptor(financialBook).intercept(
                financialBook,
                createEvent(deletedCogs)
            );

            expect(result.result).toEqual([
                "<a href='https://app.bkper.com/b/#transactions:bookId=inventory'>Inventory</a>: Flagging account for rebuild",
            ]);
        }

        expect(
            queries.filter(query => query.startsWith('inventory:')).map(query => query.slice(10))
        ).toEqual([
            'missing',
            'inventory-sale-#COGS Sale',
            'missing',
            'inventory-sale-#cost_of_sale Sale',
            'missing',
            'inventory-sale-Calculated by bot',
        ]);
        expect(
            operations.filter(operation => operation.startsWith('update-account:'))
        ).toHaveLength(3);
    });

    test('preserves malformed, unposted, unsupported, and non-bot COGS no-ops', async () => {
        const { financialBook } = createBooks();
        const account = registerAccount(financialBook, 'Results', AccountType.OUTGOING);
        const unsupported = createTransaction('unsupported', account, account, {
            agentId: 'user',
            description: '#COGS',
            remoteIds: ['inventory-sale'],
        });
        const realSaleDirection = createTransaction('real-sale', account, account, {
            properties: { good: 'T-shirts' },
            creditAccount: { id: 'sales', name: 'Sales', type: AccountType.INCOMING },
            debitAccount: { id: 'bank', name: 'Bank', type: AccountType.ASSET },
        });
        const missingAdditionalCostAccount = createTransaction(
            'missing-additional-cost-account',
            account,
            account,
            {
                properties: {
                    purchase_code: 'PURCHASE-1',
                    purchase_invoice: 'INVOICE-OTHER',
                },
                creditAccount: {
                    id: 'missing-good',
                    name: 'Missing good',
                    type: AccountType.ASSET,
                },
            }
        );

        const interceptor = createInterceptor(financialBook);
        expect(await interceptor.intercept(financialBook, { type: 'TRANSACTION_DELETED' })).toEqual(
            { result: false }
        );
        expect(
            await interceptor.intercept(
                financialBook,
                createEvent({ ...unsupported, posted: false })
            )
        ).toEqual({ result: false });
        expect(await interceptor.intercept(financialBook, createEvent(unsupported))).toEqual({
            result: false,
        });
        expect(await interceptor.intercept(financialBook, createEvent(realSaleDirection))).toEqual({
            result: false,
        });
        expect(
            await interceptor.intercept(financialBook, createEvent(missingAdditionalCostAccount))
        ).toEqual({ result: false });
        expect(queries).toEqual([]);
        expect(operations).toEqual([]);
    });
});
