import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book, Transaction, TransactionList } from 'bkper-js';
import { EventHandlerTransactionPosted } from '../../src/events/handlers/EventHandlerTransactionPosted.js';
import { AppContext } from '../../src/shared/app-context.js';

const originalBookListTransactions = Book.prototype.listTransactions;
const originalTransactionTrash = Transaction.prototype.trash;
const originalTransactionUncheck = Transaction.prototype.uncheck;

afterEach(() => {
    Book.prototype.listTransactions = originalBookListTransactions;
    Transaction.prototype.trash = originalTransactionTrash;
    Transaction.prototype.uncheck = originalTransactionUncheck;
});

function createContext(): AppContext {
    return new AppContext(new Bkper(), { ASSETS: { fetch } });
}

function createEventBookPayload(inventory: boolean): bkper.Book {
    return {
        id: inventory ? 'inventory' : 'financial',
        name: inventory ? 'Inventory' : 'Financial',
        properties: inventory ? { inventory_book: 'true' } : { exc_code: 'USD' },
        collection: {
            books: [
                {
                    id: 'inventory',
                    name: 'Inventory',
                    properties: { inventory_book: 'true' },
                },
            ],
        },
    };
}

function createEvent(): bkper.Event {
    return {
        type: 'TRANSACTION_POSTED',
        book: createEventBookPayload(true),
        agent: { id: 'user' },
        user: { username: 'tester' },
        data: {
            object: {
                transaction: {
                    id: 'transaction-1',
                    posted: true,
                    checked: true,
                    date: '2024-01-02',
                    amount: '10',
                    creditAccount: { id: 'origin', name: 'Origin', type: 'ASSET' },
                    debitAccount: { id: 'destination', name: 'Destination', type: 'ASSET' },
                    properties: {},
                },
            },
        },
    };
}

describe('legacy transaction posted handler', () => {
    test('awaits uncheck then trash and warns for direct Inventory Book posting', async () => {
        const event = createEvent();
        const eventBook = new Book(event.book);
        const transaction = new Transaction(eventBook, {
            ...(event.data!.object as bkper.TransactionOperation).transaction!,
        });
        const operations: string[] = [];
        let releaseTrash: (() => void) | undefined;
        let signalTrashStarted: (() => void) | undefined;
        const trashStarted = new Promise<void>(resolve => {
            signalTrashStarted = resolve;
        });

        Book.prototype.listTransactions = async function (query?: string) {
            operations.push(`query:${query}`);
            return new TransactionList(this, { items: [transaction.json()] });
        };
        Transaction.prototype.uncheck = async function () {
            operations.push('uncheck');
            this.setChecked(false);
            return this;
        };
        Transaction.prototype.trash = async function () {
            operations.push('trash');
            signalTrashStarted?.();
            await new Promise<void>(resolve => {
                releaseTrash = resolve;
            });
            return this;
        };

        const resultPromise = new EventHandlerTransactionPosted(createContext()).handleEvent(event);
        await trashStarted;
        let settled = false;
        void resultPromise.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBeFalse();

        releaseTrash?.();
        expect(await resultPromise).toEqual({
            warning: "You can't post directly in the Inventory book. Transaction deleted.",
        });
        expect(operations).toEqual(['query:transaction-1', 'uncheck', 'trash']);
    });

    test('preserves direct posting warning and no-op boundaries', async () => {
        let queries = 0;
        Book.prototype.listTransactions = async function () {
            queries += 1;
            return new TransactionList(this, { items: [] });
        };
        const handler = new EventHandlerTransactionPosted(createContext());
        const missingTransactionResult = await handler.handleEvent(createEvent());
        const missingObjectResult = await handler.handleEvent({
            ...createEvent(),
            data: {},
        });
        const financialResult = await handler.handleEvent({
            ...createEvent(),
            book: createEventBookPayload(false),
        });

        expect(missingTransactionResult).toEqual({
            warning: "You can't post directly in the Inventory book. Transaction deleted.",
        });
        expect(missingObjectResult).toEqual({ result: false });
        expect(financialResult).toEqual({ result: false });
        expect(queries).toBe(1);
    });
});
