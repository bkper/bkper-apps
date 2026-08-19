import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group, Transaction, TransactionList } from 'bkper-js';
import { EventHandlerTransactionRestored } from '../../../src/events/handlers/EventHandlerTransactionRestored.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalTransactionUntrash = Transaction.prototype.untrash;
const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;
const restoredTransactionIds: string[] = [];

afterEach(() => {
    Transaction.prototype.untrash = originalTransactionUntrash;
    console.time = originalConsoleTime;
    console.timeEnd = originalConsoleTimeEnd;
    restoredTransactionIds.length = 0;
});

function createFixture(): {
    financialBook: Book;
    financialTransaction: bkper.Transaction;
    portfolioBook: Book;
    queries: string[];
} {
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
            properties: { stock_book: 'true' },
        },
    ];
    const collection: bkper.Collection = { books: collectionBooks };
    const financialBook = new Book({ ...collectionBooks[0], collection });
    const portfolioBook = new Book({ ...collectionBooks[1], collection });
    const books = [financialBook, portfolioBook];
    financialBook.getCollection()!.getBooks = () => books;
    portfolioBook.getCollection()!.getBooks = () => books;

    const financialGroup = new Group(financialBook, {
        id: 'financial-market',
        name: 'NASDAQ',
        properties: { stock_exc_code: 'USD' },
    });
    const financialCash = new Account(financialBook, {
        id: 'financial-cash',
        name: 'Cash',
        type: AccountType.ASSET,
    });
    const financialInstrument = new Account(financialBook, {
        id: 'financial-acme',
        name: 'ACME',
        type: AccountType.ASSET,
        groups: [financialGroup.json()],
    });
    const buy = new Account(portfolioBook, {
        id: 'portfolio-buy',
        name: 'Buy',
        type: AccountType.INCOMING,
    });
    const portfolioInstrument = new Account(portfolioBook, {
        id: 'portfolio-acme',
        name: 'ACME',
        type: AccountType.ASSET,
    });
    const accounts = new Map<string, Account>([
        [buy.getId()!, buy],
        [portfolioInstrument.getId()!, portfolioInstrument],
    ]);
    portfolioBook.getAccount = async id => accounts.get(id ?? '');

    const restoredMirror: bkper.Transaction = {
        id: 'portfolio-mirror',
        posted: true,
        trashed: true,
        date: '2024-01-02',
        dateFormatted: '2024-01-02',
        amount: '10',
        description: 'Restored trade',
        creditAccount: buy.json(),
        debitAccount: portfolioInstrument.json(),
        remoteIds: ['financial-trade'],
        properties: {},
    };
    const queries: string[] = [];
    portfolioBook.listTransactions = async query => {
        queries.push(query ?? '');
        return new TransactionList(portfolioBook, { items: [restoredMirror] });
    };

    const financialTransaction: bkper.Transaction = {
        id: 'financial-trade',
        posted: true,
        date: '2024-01-02',
        amount: '100',
        description: 'Restored trade',
        creditAccount: financialCash.json(),
        debitAccount: financialInstrument.json(),
        properties: {},
    };

    return { financialBook, financialTransaction, portfolioBook, queries };
}

function createHandler(financialBook: Book): EventHandlerTransactionRestored {
    const bkper = new Bkper();
    bkper.getBook = async () => financialBook;
    return new EventHandlerTransactionRestored(
        new AppContext(bkper, {
            ASSETS: { fetch },
        })
    );
}

describe('legacy restored transaction behavior', () => {
    test('finds a trashed Portfolio mirror and restores it', async () => {
        console.time = () => undefined;
        console.timeEnd = () => undefined;
        Transaction.prototype.untrash = async function (): Promise<Transaction> {
            restoredTransactionIds.push(this.getId()!);
            return this;
        };
        const fixture = createFixture();
        const event: bkper.Event = {
            type: 'TRANSACTION_RESTORED',
            bookId: fixture.financialBook.getId(),
            user: { username: 'tester' },
            agent: { id: 'user' },
            data: { object: { transaction: fixture.financialTransaction } },
        };

        const result = await createHandler(fixture.financialBook).handleEvent(event);

        expect(fixture.queries).toEqual(['remoteId:financial-trade is:trashed']);
        expect(restoredTransactionIds).toEqual(['portfolio-mirror']);
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: RESTORED: 2024-01-02 10 Buy ACME Restored trade",
        ]);
    });
});
