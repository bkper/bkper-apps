import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Transaction } from 'bkper-js';
import { EventHandlerTransactionUnchecked } from '../../../src/events/handlers/EventHandlerTransactionUnchecked.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalAccountUpdate = Account.prototype.update;
const updatedAccountIds: string[] = [];

afterEach(() => {
    Account.prototype.update = originalAccountUpdate;
    updatedAccountIds.length = 0;
});

function createFixture(): {
    book: Book;
    transaction: bkper.Transaction;
} {
    const book = new Book({
        id: 'portfolio',
        name: 'Portfolio',
        fractionDigits: 0,
        properties: { stock_book: 'true' },
    });
    const buy = new Account(book, {
        id: 'portfolio-buy',
        name: 'Buy',
        type: AccountType.INCOMING,
    });
    const instrument = new Account(book, {
        id: 'portfolio-acme',
        name: 'ACME',
        type: AccountType.ASSET,
    });
    const accounts = new Map<string, Account>([
        [buy.getId()!, buy],
        [instrument.getId()!, instrument],
    ]);
    book.getAccount = async id => accounts.get(id ?? '');

    const transaction: bkper.Transaction = {
        id: 'portfolio-trade',
        posted: true,
        checked: false,
        date: '2024-01-02',
        amount: '10',
        creditAccount: buy.json(),
        debitAccount: instrument.json(),
        properties: {},
    };
    book.getTransaction = async () => new Transaction(book, transaction);

    return { book, transaction };
}

function createHandler(book: Book): EventHandlerTransactionUnchecked {
    const bkper = new Bkper();
    bkper.getBook = async () => book;
    return new EventHandlerTransactionUnchecked(
        new AppContext(bkper, {
            ASSETS: { fetch },
        })
    );
}

describe('legacy unchecked transaction behavior', () => {
    test('delegates the event to Portfolio rebuild interception', async () => {
        Account.prototype.update = async function (): Promise<Account> {
            updatedAccountIds.push(this.getId()!);
            return this;
        };
        const fixture = createFixture();
        const event: bkper.Event = {
            type: 'TRANSACTION_UNCHECKED',
            bookId: fixture.book.getId(),
            user: { username: 'tester' },
            agent: { id: 'user' },
            data: { object: { transaction: fixture.transaction } },
        };

        const result = await createHandler(fixture.book).handleEvent(event);

        expect(updatedAccountIds).toEqual(['portfolio-acme']);
        expect(result).toEqual({
            warning: 'Flagging account ACME for rebuild',
            result: 'Flagging account ACME for rebuild',
        });
    });
});
