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
import { InterceptorOrderProcessorDeleteGoods } from '../../src/events/interceptors/InterceptorOrderProcessorDeleteGoods.js';
import { AppContext } from '../../src/shared/app-context.js';

const originalAccountCreate = Account.prototype.create;
const originalAccountUpdate = Account.prototype.update;
const originalTransactionPost = Transaction.prototype.post;
const originalTransactionTrash = Transaction.prototype.trash;
const originalTransactionUncheck = Transaction.prototype.uncheck;

let accountsByBook: Map<string, Map<string, Account>>;
let fixturesByQuery: Map<string, bkper.Transaction[]>;
let operations: string[];
let queries: string[];

beforeEach(() => {
    accountsByBook = new Map();
    fixturesByQuery = new Map();
    operations = [];
    queries = [];

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

function createBooks(): { financialBook: Book; inventoryBook: Book } {
    const collection: bkper.Collection = {
        books: [
            {
                id: 'financial',
                name: 'Financial',
                properties: { exc_code: 'USD' },
            },
            {
                id: 'inventory',
                name: 'Inventory',
                properties: { inventory_book: 'true' },
            },
        ],
    };
    const financialBook = new Book({ ...collection.books![0], collection });
    const inventoryBook = new Book({ ...collection.books![1], collection });
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

function registerAccount(book: Book, name: string, type: AccountType): Account {
    const account = new Account(book, {
        id: `${book.getId()}-${name.toLowerCase().replaceAll(' ', '-')}`,
        name,
        type,
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

function createEvent(transaction: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_DELETED',
        data: { object: { transaction } },
    };
}

function createInterceptor(financialBook: Book): InterceptorOrderProcessorDeleteGoods {
    const bkper = new Bkper();
    bkper.getBook = async () => financialBook;
    return new InterceptorOrderProcessorDeleteGoods(new AppContext(bkper, { ASSETS: { fetch } }));
}

describe('legacy Inventory Book deletion behavior', () => {
    test('flags a processed root and deletes split movements in source order', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const good = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET);
        const classifierAccount = registerAccount(
            inventoryBook,
            'Legacy incoming classifier',
            AccountType.INCOMING
        );
        const split = createTransaction('split-1', classifierAccount, good, {
            amount: '4',
            properties: { parent_id: 'root-1' },
        });
        fixturesByQuery.set("inventory:account:'Legacy incoming classifier'", [split]);
        const root = createTransaction('root-1', good, classifierAccount, {
            amount: '6',
            properties: { original_quantity: '10' },
        });

        const result = await createInterceptor(financialBook).intercept(
            inventoryBook,
            createEvent(root)
        );

        expect(queries).toEqual(["inventory:account:'Legacy incoming classifier'"]);
        expect(operations).toEqual(['update-account:T-shirts', 'uncheck:split-1', 'trash:split-1']);
        expect(result).toEqual({
            result: [
                'Flagging account T-shirts for rebuild',
                'DELETED: 2024-01-02 4 Legacy incoming classifier T-shirts split-1',
            ],
        });
    });

    test('deletes linked Financial COGS for a classified Inventory movement', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const good = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET);
        const classifierAccount = registerAccount(
            inventoryBook,
            'Legacy incoming classifier',
            AccountType.INCOMING
        );
        const cogs = registerAccount(financialBook, 'Cost of goods sold', AccountType.OUTGOING);
        const financialGood = registerAccount(financialBook, 'T-shirts', AccountType.ASSET);
        const group = new Group(inventoryBook, {
            id: 'inventory-usd',
            name: 'USD Inventory',
            properties: { exc_code: 'USD' },
        });
        good.getGroups = async () => [group];
        const deletedMovement = createTransaction('inventory-movement', good, classifierAccount);
        const linkedCogs = createTransaction('financial-cogs', financialGood, cogs);
        fixturesByQuery.set('financial:remoteId:inventory-movement', [linkedCogs]);

        const result = await createInterceptor(financialBook).intercept(
            inventoryBook,
            createEvent(deletedMovement)
        );

        expect(queries).toEqual(['financial:remoteId:inventory-movement']);
        expect(operations).toEqual(['uncheck:financial-cogs', 'trash:financial-cogs']);
        expect(result).toEqual({
            result: [
                "<a href='https://app.bkper.com/b/#transactions:bookId=financial'>Financial</a>: DELETED: 2024-01-02 10 T-shirts Cost of goods sold financial-cogs",
            ],
        });
    });

    test('preserves generated purchase, sale, complete-root, unsupported, and unposted no-ops', async () => {
        const { financialBook, inventoryBook } = createBooks();
        const buy = registerAccount(inventoryBook, 'Buy', AccountType.INCOMING);
        const good = registerAccount(inventoryBook, 'T-shirts', AccountType.ASSET);
        const sell = registerAccount(inventoryBook, 'Sell', AccountType.OUTGOING);
        const completeQualifiedRoot = createTransaction('complete-root', good, buy, {
            properties: { original_quantity: '10' },
        });
        const generatedPurchase = createTransaction('purchase', buy, good, {
            properties: { original_quantity: '10' },
        });
        const generatedSale = createTransaction('sale', good, sell);
        const unsupported = createTransaction('unsupported', good, good);
        const missingQualifiedAccount = createTransaction('missing-qualified', good, buy, {
            creditAccount: {
                id: 'missing-good',
                name: 'Missing good',
                type: AccountType.ASSET,
            },
        });

        const interceptor = createInterceptor(financialBook);
        expect(
            await interceptor.intercept(inventoryBook, createEvent(completeQualifiedRoot))
        ).toEqual({ result: false });
        expect(await interceptor.intercept(inventoryBook, createEvent(generatedPurchase))).toEqual({
            result: false,
        });
        expect(await interceptor.intercept(inventoryBook, createEvent(generatedSale))).toEqual({
            result: false,
        });
        expect(await interceptor.intercept(inventoryBook, createEvent(unsupported))).toEqual({
            result: false,
        });
        expect(
            await interceptor.intercept(inventoryBook, createEvent(missingQualifiedAccount))
        ).toEqual({ result: false });
        expect(
            await interceptor.intercept(
                inventoryBook,
                createEvent({ ...completeQualifiedRoot, posted: false })
            )
        ).toEqual({ result: false });
        expect(queries).toEqual([]);
        expect(operations).toEqual([]);
    });
});
