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
import { InterceptorOrderProcessorDeleteFinancial } from '../../../src/events/interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalAccountUpdate = Account.prototype.update;
const originalTransactionTrash = Transaction.prototype.trash;
const originalTransactionUncheck = Transaction.prototype.uncheck;

interface BooksFixture {
    baseBook: Book;
    financialBook: Book;
    portfolioBook: Book;
}

let accountUpdates: bkper.Account[];
let accountsByBook: Map<string, Map<string, Account>>;
let listFixtures: Map<string, Map<string, bkper.Transaction[]>>;
let queries: string[];
let transactionFixtures: Map<string, bkper.Transaction>;
let transactionLookups: string[];
let trashFailure: { error: Error; transactionId: string } | null;
let trashGateId: string | null;
let trashGateRelease: (() => void) | null;
let trashGateStarted: (() => void) | null;
let trashedTransactions: bkper.Transaction[];

beforeEach(() => {
    accountUpdates = [];
    accountsByBook = new Map();
    listFixtures = new Map();
    queries = [];
    transactionFixtures = new Map();
    transactionLookups = [];
    trashFailure = null;
    trashGateId = null;
    trashGateRelease = null;
    trashGateStarted = null;
    trashedTransactions = [];

    Account.prototype.update = async function (): Promise<Account> {
        accountUpdates.push(this.json());
        return this;
    };
    Transaction.prototype.trash = async function (): Promise<Transaction> {
        trashedTransactions.push(this.json());
        const failure = trashFailure;
        if (failure && this.getId() === failure.transactionId) {
            throw failure.error;
        }
        if (this.getId() === trashGateId) {
            trashGateStarted?.();
            await new Promise<void>(resolve => {
                trashGateRelease = resolve;
            });
        }
        return this;
    };
    Transaction.prototype.uncheck = async function (): Promise<Transaction> {
        this.setChecked(false);
        return this;
    };
});

afterEach(() => {
    Account.prototype.update = originalAccountUpdate;
    Transaction.prototype.trash = originalTransactionTrash;
    Transaction.prototype.uncheck = originalTransactionUncheck;
});

function createBooks(): BooksFixture {
    const collectionBooks: bkper.Book[] = [
        {
            id: 'financial',
            name: 'Financial',
            fractionDigits: 2,
            properties: { exc_code: 'USD' },
        },
        {
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            properties: {
                stock_book: 'true',
                stock_fair: 'true',
                stock_historical: 'true',
            },
        },
        {
            id: 'base',
            name: 'Base',
            fractionDigits: 2,
            properties: { exc_base: 'true', exc_code: 'USD' },
        },
    ];
    const collection: bkper.Collection = { books: collectionBooks };
    const financialBook = new Book({ ...collectionBooks[0], collection });
    const portfolioBook = new Book({ ...collectionBooks[1], collection });
    const baseBook = new Book({ ...collectionBooks[2], collection });
    const books = [financialBook, portfolioBook, baseBook];
    configureBooks(books);

    return { baseBook, financialBook, portfolioBook };
}

function createBooksWithoutBase(): {
    financialBook: Book;
    portfolioBook: Book;
} {
    const collectionBooks: bkper.Book[] = [
        {
            id: 'financial',
            name: 'Financial',
            fractionDigits: 2,
            properties: { exc_code: 'EUR' },
        },
        {
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            properties: {
                stock_book: 'true',
                stock_fair: 'true',
                stock_historical: 'true',
            },
        },
    ];
    const collection: bkper.Collection = { books: collectionBooks };
    const financialBook = new Book({ ...collectionBooks[0], collection });
    const portfolioBook = new Book({ ...collectionBooks[1], collection });
    configureBooks([financialBook, portfolioBook]);
    return { financialBook, portfolioBook };
}

function configureBooks(books: Book[]): void {
    for (const book of books) {
        book.getCollection()!.getBooks = () => books;
        book.getAccount = async idOrName => getAccountMap(book).get(idOrName ?? '');
        book.getTransaction = async id => {
            transactionLookups.push(`${book.getId()}:${id}`);
            const payload = transactionFixtures.get(id);
            if (payload) {
                return new Transaction(book, payload);
            }
            throw new BkperError(404, `Transaction ${id} not found`, 'notFound');
        };
        book.listTransactions = async query => {
            queries.push(`${book.getId()}:${query ?? ''}`);
            const payloads = listFixtures.get(book.getId())?.get(query ?? '') ?? [];
            return new TransactionList(book, { items: payloads });
        };
    }
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
    getAccountMap(book).set(account.getId()!, account);
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
    let fixtures = listFixtures.get(book.getId());
    if (!fixtures) {
        fixtures = new Map();
        listFixtures.set(book.getId(), fixtures);
    }
    fixtures.set(query, items);
}

function registerLegacyCascade(
    financialBook: Book,
    baseBook: Book,
    portfolioTransactionId: string,
    financialAccount: Account,
    baseAccount: Account
): void {
    const fixtures: readonly [Book, string, string, Account][] = [
        [financialBook, '', 'realized-result', financialAccount],
        [financialBook, 'mtm_', 'mtm-result', financialAccount],
        [baseBook, 'fx_', 'fx-result', baseAccount],
        [financialBook, 'hist_', 'historical-result', financialAccount],
        [financialBook, 'mtm_hist_', 'historical-mtm-result', financialAccount],
        [baseBook, 'fx_hist_', 'historical-fx-result', baseAccount],
    ];
    for (const [book, prefix, id, account] of fixtures) {
        registerList(book, `remoteId:${prefix}${portfolioTransactionId}`, [
            createTransaction(id, account, account),
        ]);
    }
}

function createEvent(transaction: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_DELETED',
        data: { object: { transaction } },
    };
}

function createInterceptor(): InterceptorOrderProcessorDeleteFinancial {
    return new InterceptorOrderProcessorDeleteFinancial(
        new AppContext(new Bkper(), {
            ASSETS: { fetch },
        })
    );
}

describe('legacy Financial order deletion behavior', () => {
    test('awaits the exact legacy split, Portfolio, and linked cleanup set', async () => {
        const { baseBook, financialBook, portfolioBook } = createBooks();
        const broker = registerAccount(financialBook, 'Broker', AccountType.ASSET);
        const fees = registerAccount(financialBook, 'Broker Fees', AccountType.OUTGOING);
        const interest = registerAccount(financialBook, 'ACME Interest', AccountType.ASSET);
        const financialInstrument = registerAccount(financialBook, 'ACME', AccountType.ASSET);
        const buy = registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        const portfolioInstrument = registerAccount(portfolioBook, 'ACME', AccountType.ASSET, {
            realized_date: '2024-01-03',
        });
        const baseAccount = registerAccount(baseBook, 'USD', AccountType.ASSET);
        const sourceOrder = createTransaction('order-1', broker, broker);

        registerList(financialBook, 'remoteId:fees_order-1', [
            createTransaction('old-fees', broker, fees),
        ]);
        registerList(financialBook, 'remoteId:interest_order-1', [
            createTransaction('old-interest', broker, interest),
        ]);
        registerList(financialBook, 'remoteId:instrument_order-1', [
            createTransaction('old-instrument', broker, financialInstrument),
        ]);
        const portfolioMirror = createTransaction('portfolio-mirror', buy, portfolioInstrument);
        registerList(portfolioBook, 'remoteId:old-instrument', [portfolioMirror]);
        registerLegacyCascade(financialBook, baseBook, portfolioMirror.id!, broker, baseAccount);

        trashGateId = 'historical-fx-result';
        const gateStarted = new Promise<void>(resolve => {
            trashGateStarted = resolve;
        });
        const interceptorPromise = createInterceptor().intercept(
            financialBook,
            createEvent(sourceOrder)
        );

        await gateStarted;
        let settled = false;
        void interceptorPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        trashGateRelease?.();
        const result = await interceptorPromise;

        expect(trashedTransactions.map(transaction => transaction.id)).toEqual([
            'old-fees',
            'old-interest',
            'old-instrument',
            'portfolio-mirror',
            'realized-result',
            'mtm-result',
            'fx-result',
            'historical-result',
            'historical-mtm-result',
            'historical-fx-result',
        ]);
        expect(accountUpdates.map(account => account.id)).toEqual([portfolioInstrument.getId()!]);
        expect(queries).not.toContain('financial:remoteId:interestmtm_portfolio-mirror');
        expect(result.result).toEqual([
            'DELETED: 2024-01-02 10 Broker Broker Fees old-fees',
            'DELETED: 2024-01-02 10 Broker ACME Interest old-interest',
        ]);
    });

    test('waits for sibling cleanup before propagating a deletion failure', async () => {
        const { financialBook, portfolioBook } = createBooks();
        const financialAccount = registerAccount(financialBook, 'Results', AccountType.INCOMING);
        const buy = registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        const instrument = registerAccount(portfolioBook, 'ACME', AccountType.ASSET);
        const sourceTransaction = createTransaction(
            'source-transaction',
            financialAccount,
            financialAccount
        );
        const portfolioMirror = createTransaction('portfolio-mirror', buy, instrument);
        registerList(portfolioBook, 'remoteId:source-transaction', [portfolioMirror]);
        registerList(financialBook, 'remoteId:portfolio-mirror', [
            createTransaction('realized-result', financialAccount, financialAccount),
        ]);
        registerList(financialBook, 'remoteId:mtm_portfolio-mirror', [
            createTransaction('mtm-result', financialAccount, financialAccount),
        ]);

        const expectedError = new Error('Realized cleanup failed');
        trashFailure = { error: expectedError, transactionId: 'realized-result' };
        trashGateId = 'mtm-result';
        const gateStarted = new Promise<void>(resolve => {
            trashGateStarted = resolve;
        });
        const interceptorPromise = createInterceptor().intercept(
            financialBook,
            createEvent(sourceTransaction)
        );

        await gateStarted;
        let settled = false;
        void interceptorPromise.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            }
        );
        for (let microtask = 0; microtask < 10; microtask += 1) {
            await Promise.resolve();
        }
        expect(settled).toBeFalse();

        trashGateRelease?.();
        await expect(interceptorPromise).rejects.toBe(expectedError);
        expect(trashedTransactions.map(transaction => transaction.id)).toEqual([
            'portfolio-mirror',
            'realized-result',
            'mtm-result',
        ]);
    });

    test('completes applicable cleanup when the collection has no Base or USD Book', async () => {
        const { financialBook, portfolioBook } = createBooksWithoutBase();
        const financialAccount = registerAccount(financialBook, 'Results', AccountType.INCOMING);
        const buy = registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        const instrument = registerAccount(portfolioBook, 'ACME', AccountType.ASSET, {
            realized_date: '2024-01-03',
        });
        const sourceTransaction = createTransaction(
            'source-transaction',
            financialAccount,
            financialAccount
        );
        const portfolioMirror = createTransaction('portfolio-mirror', buy, instrument);
        registerList(portfolioBook, 'remoteId:source-transaction', [portfolioMirror]);
        for (const [prefix, id] of [
            ['', 'realized-result'],
            ['mtm_', 'mtm-result'],
            ['hist_', 'historical-result'],
            ['mtm_hist_', 'historical-mtm-result'],
        ] as const) {
            registerList(financialBook, `remoteId:${prefix}portfolio-mirror`, [
                createTransaction(id, financialAccount, financialAccount),
            ]);
        }

        const result = await createInterceptor().intercept(
            financialBook,
            createEvent(sourceTransaction)
        );

        expect(trashedTransactions.map(transaction => transaction.id)).toEqual([
            'portfolio-mirror',
            'realized-result',
            'mtm-result',
            'historical-result',
            'historical-mtm-result',
        ]);
        expect(queries.filter(query => query.includes('remoteId:fx_'))).toEqual([]);
        expect(queries.filter(query => query.includes('remoteId:fx_hist_'))).toEqual([]);
        expect(result).toEqual({ result: false });
    });

    test('preserves unposted and missing linked-resource deletion no-ops', async () => {
        const { financialBook } = createBooks();
        const financialAccount = registerAccount(financialBook, 'Broker', AccountType.ASSET);
        const missingResources = createTransaction(
            'missing-resources',
            financialAccount,
            financialAccount
        );

        const missingResult = await createInterceptor().intercept(
            financialBook,
            createEvent(missingResources)
        );

        expect(queries).toEqual([
            'financial:remoteId:fees_missing-resources',
            'financial:remoteId:interest_missing-resources',
            'financial:remoteId:instrument_missing-resources',
            'portfolio:remoteId:missing-resources',
        ]);
        expect(trashedTransactions).toEqual([]);
        expect(accountUpdates).toEqual([]);
        expect(missingResult).toEqual({ result: false });

        queries.length = 0;
        const unpostedResult = await createInterceptor().intercept(
            financialBook,
            createEvent({ ...missingResources, posted: false })
        );
        expect(queries).toEqual([]);
        expect(unpostedResult).toEqual({ result: false });
    });

    test('continues past a missing temporary remote ID to flag the canonical Portfolio Account', async () => {
        const { financialBook, portfolioBook } = createBooks();
        const buy = registerAccount(portfolioBook, 'Buy', AccountType.INCOMING);
        const instrument = registerAccount(portfolioBook, 'ACME', AccountType.ASSET, {
            realized_date: '2024-01-03',
        });
        transactionFixtures.set(
            'portfolio-trade',
            createTransaction('portfolio-trade', buy, instrument, { checked: false })
        );
        const financialAccount = registerAccount(financialBook, 'Results', AccountType.INCOMING);
        const deletedGain = createTransaction('gain-result', financialAccount, financialAccount, {
            agentId: 'stock-bot',
            description: '#stock_gain',
            remoteIds: ['crrp_id_temporary', 'portfolio-trade'],
        });

        const result = await createInterceptor().intercept(financialBook, createEvent(deletedGain));

        expect(transactionLookups).toEqual([
            'portfolio:crrp_id_temporary',
            'portfolio:portfolio-trade',
        ]);
        expect(accountUpdates.map(account => account.id)).toEqual([instrument.getId()!]);
        expect(result).toEqual({ result: false });
    });
});
