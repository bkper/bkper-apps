import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group, Transaction, TransactionList } from 'bkper-js';
import { InterceptorOrderProcessorDeleteInstruments } from '../../../src/events/interceptors/InterceptorOrderProcessorDeleteInstruments.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalTransactionTrash = Transaction.prototype.trash;
const originalTransactionUncheck = Transaction.prototype.uncheck;

let queries: string[];
let trashGateRelease: (() => void) | null;
let trashGateStarted: (() => void) | null;
let trashedTransactionIds: string[];

beforeEach(() => {
    queries = [];
    trashGateRelease = null;
    trashGateStarted = null;
    trashedTransactionIds = [];

    Transaction.prototype.trash = async function (): Promise<Transaction> {
        trashedTransactionIds.push(this.getId()!);
        if (this.getId() === 'historical-fx-result') {
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
    Transaction.prototype.trash = originalTransactionTrash;
    Transaction.prototype.uncheck = originalTransactionUncheck;
});

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
        amount: '10',
        description: id,
        creditAccount: creditAccount.json(),
        debitAccount: debitAccount.json(),
        properties: {},
        ...overrides,
    };
}

describe('legacy Portfolio movement deletion behavior', () => {
    test('awaits the exact linked cleanup set in the matching Financial and Base Books', async () => {
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
        for (const book of books) {
            book.getCollection()!.getBooks = () => books;
        }

        const market = new Group(portfolioBook, {
            id: 'portfolio-market',
            name: 'NASDAQ',
            properties: { stock_exc_code: 'USD' },
        });
        const instrument = new Account(portfolioBook, {
            id: 'portfolio-acme',
            name: 'ACME',
            type: AccountType.ASSET,
            permanent: true,
            groups: [market.json()],
        });
        instrument.getGroups = async () => [market];
        const sell = new Account(portfolioBook, {
            id: 'portfolio-sell',
            name: 'Sell',
            type: AccountType.OUTGOING,
        });
        const portfolioAccounts = new Map<string, Account>([
            [instrument.getId()!, instrument],
            [sell.getId()!, sell],
        ]);
        portfolioBook.getAccount = async id => portfolioAccounts.get(id ?? '');
        const deletedPortfolioTransaction = createTransaction('portfolio-trade', instrument, sell, {
            description: 'Deleted sale',
        });
        portfolioBook.getTransaction = async () =>
            new Transaction(portfolioBook, deletedPortfolioTransaction);

        const financialAccount = new Account(financialBook, {
            id: 'financial-results',
            name: 'Results',
            type: AccountType.INCOMING,
        });
        const baseAccount = new Account(baseBook, {
            id: 'base-usd',
            name: 'USD',
            type: AccountType.ASSET,
        });
        const linked: readonly [Book, string, string, Account][] = [
            [financialBook, '', 'realized-result', financialAccount],
            [financialBook, 'mtm_', 'mtm-result', financialAccount],
            [baseBook, 'fx_', 'fx-result', baseAccount],
            [financialBook, 'hist_', 'historical-result', financialAccount],
            [financialBook, 'mtm_hist_', 'historical-mtm-result', financialAccount],
            [baseBook, 'fx_hist_', 'historical-fx-result', baseAccount],
        ];
        const linkedByQuery = new Map<string, bkper.Transaction>();
        for (const [book, prefix, id, account] of linked) {
            linkedByQuery.set(
                `${book.getId()}:remoteId:${prefix}portfolio-trade`,
                createTransaction(id, account, account)
            );
        }
        for (const book of [financialBook, baseBook]) {
            book.listTransactions = async query => {
                queries.push(`${book.getId()}:${query ?? ''}`);
                const transaction = linkedByQuery.get(`${book.getId()}:${query ?? ''}`);
                return new TransactionList(book, {
                    items: transaction ? [transaction] : [],
                });
            };
        }

        const bkper = new Bkper();
        bkper.getBook = async () => financialBook;
        const interceptor = new InterceptorOrderProcessorDeleteInstruments(
            new AppContext(bkper, { ASSETS: { fetch } })
        );
        const event: bkper.Event = {
            type: 'TRANSACTION_DELETED',
            data: { object: { transaction: deletedPortfolioTransaction } },
        };
        const gateStarted = new Promise<void>(resolve => {
            trashGateStarted = resolve;
        });
        const interceptorPromise = interceptor.intercept(portfolioBook, event);

        await gateStarted;
        let settled = false;
        void interceptorPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();
        trashGateRelease?.();
        const result = await interceptorPromise;

        expect(trashedTransactionIds).toEqual([
            'realized-result',
            'mtm-result',
            'fx-result',
            'historical-result',
            'historical-mtm-result',
            'historical-fx-result',
        ]);
        expect(queries).not.toContain('financial:remoteId:interestmtm_portfolio-trade');
        expect(result).toEqual({
            result: 'DELETED: 2024-01-02 10 ACME Sell Deleted sale',
        });
    });
});
