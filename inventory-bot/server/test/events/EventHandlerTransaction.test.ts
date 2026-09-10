import { describe, expect, test } from 'bun:test';
import {
    Account,
    AccountType,
    Bkper,
    BkperError,
    Book,
    Transaction,
    TransactionList,
    type Transaction as TransactionModel,
} from 'bkper-js';
import { EventHandlerTransaction } from '../../src/events/handlers/EventHandlerTransaction.js';
import { AppContext } from '../../src/shared/app-context.js';

interface ConnectedCall {
    kind: 'found' | 'not-found';
    inventoryBookId: string;
    financialTransactionId: string | undefined;
    goodExcCode?: string;
    connectedTransactionId?: string;
}

class RecordingTransactionHandler extends EventHandlerTransaction {
    readonly calls: ConnectedCall[] = [];

    run(financialBook: Book, inventoryBook: Book, event: bkper.Event): Promise<string | undefined> {
        return this.processObject(financialBook, inventoryBook, event);
    }

    setExchangeCodeResolver(
        resolver: (account: Account | bkper.Account) => Promise<string | undefined>
    ): void {
        this.botService.getExchangeCodeFromAccount = resolver;
    }

    protected override async connectedTransactionNotFound(
        inventoryBook: Book,
        financialTransaction: bkper.Transaction,
        goodExcCode?: string
    ): Promise<string> {
        this.calls.push({
            kind: 'not-found',
            inventoryBookId: inventoryBook.getId(),
            financialTransactionId: financialTransaction.id,
            goodExcCode,
        });
        return 'not-found';
    }

    protected override async connectedTransactionFound(
        inventoryBook: Book,
        connectedTransaction: TransactionModel
    ): Promise<string> {
        this.calls.push({
            kind: 'found',
            inventoryBookId: inventoryBook.getId(),
            financialTransactionId: undefined,
            connectedTransactionId: connectedTransaction.getId(),
        });
        return 'found';
    }
}

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({ id, name: id, properties, ...extra });
}

function createHandler(): RecordingTransactionHandler {
    return new RecordingTransactionHandler(new AppContext(new Bkper(), { ASSETS: { fetch } }));
}

function createEvent(transaction?: bkper.Transaction): bkper.Event {
    return {
        type: 'TRANSACTION_CHECKED',
        data: transaction === undefined ? undefined : { object: { transaction } },
    };
}

describe('legacy transaction event resolution', () => {
    test('ignores missing event data, missing Transactions, and unposted Transactions', async () => {
        const handler = createHandler();
        const financialBook = createBook('financial', { exc_code: 'USD' });
        const inventoryBook = createBook('inventory', { inventory_book: 'true' });

        expect(await handler.run(financialBook, inventoryBook, createEvent())).toBeUndefined();
        expect(
            await handler.run(financialBook, inventoryBook, {
                type: 'TRANSACTION_CHECKED',
                data: { object: {} },
            })
        ).toBeUndefined();
        expect(
            await handler.run(
                financialBook,
                inventoryBook,
                createEvent({ id: 'draft', posted: false })
            )
        ).toBeUndefined();
        expect(handler.calls).toEqual([]);
    });

    test('resolves sale exchange code from the good property before matching remote id', async () => {
        const handler = createHandler();
        const financialBook = createBook('financial', { exc_code: 'USD' });
        const goodAccount = new Account(financialBook, {
            id: 'good',
            name: 'Good',
            type: AccountType.ASSET,
        });
        financialBook.getAccount = async name => (name === 'Good' ? goodAccount : undefined);
        handler.setExchangeCodeResolver(async () => 'EUR');
        let queries = 0;
        const inventoryBook = createBook('inventory', { inventory_book: 'true' });
        inventoryBookList(inventoryBook, () => {
            queries += 1;
            return undefined;
        });

        const result = await handler.run(
            financialBook,
            inventoryBook,
            createEvent({
                id: 'financial-1',
                posted: true,
                properties: { good: 'Good' },
            })
        );

        expect(result).toBeUndefined();
        expect(queries).toBe(0);
        expect(handler.calls).toEqual([]);
    });

    test('falls back to the debit Account exchange code when the good Account is absent', async () => {
        const handler = createHandler();
        const financialBook = createBook('financial', { exc_code: 'USD' });
        financialBook.getAccount = async () => {
            throw new BkperError(404, 'Account not found', 'notFound');
        };
        handler.setExchangeCodeResolver(async account => {
            const name = account instanceof Account ? account.getName() : account.name;
            return name === 'Purchased Good' ? 'USD' : undefined;
        });
        const inventoryBook = createBook('inventory', { inventory_book: 'true' });
        inventoryBookList(inventoryBook, () => undefined);

        const result = await handler.run(
            financialBook,
            inventoryBook,
            createEvent({
                id: 'financial-1',
                posted: true,
                debitAccount: { name: 'Purchased Good', type: AccountType.ASSET },
                properties: { good: 'Missing Good' },
            })
        );

        expect(result).toBe('not-found');
        expect(handler.calls).toEqual([
            {
                kind: 'not-found',
                inventoryBookId: 'inventory',
                financialTransactionId: 'financial-1',
                goodExcCode: 'USD',
            },
        ]);
    });

    test('uses the legacy remote-id query and chooses the found boundary', async () => {
        const handler = createHandler();
        const financialBook = createBook('financial', { exc_code: 'USD' });
        const inventoryBook = createBook('inventory', { inventory_book: 'true' });
        const connected = new Transaction(inventoryBook, { id: 'inventory-1', posted: true });
        const later = new Transaction(inventoryBook, { id: 'inventory-2', posted: true });
        const queries: string[] = [];
        inventoryBook.listTransactions = async query => {
            queries.push(query ?? '');
            return new TransactionList(inventoryBook, {
                items: [connected.json(), later.json()],
            });
        };

        const result = await handler.run(
            financialBook,
            inventoryBook,
            createEvent({ id: 'financial-1', posted: true })
        );

        expect(result).toBe('found');
        expect(queries).toEqual(['remoteId:financial-1']);
        expect(handler.calls).toEqual([
            {
                kind: 'found',
                inventoryBookId: 'inventory',
                financialTransactionId: undefined,
                connectedTransactionId: 'inventory-1',
            },
        ]);
    });
});

function inventoryBookList(book: Book, first: () => TransactionModel | undefined): void {
    book.listTransactions = async () => {
        const transaction = first();
        return new TransactionList(book, {
            items: transaction ? [transaction.json()] : [],
        });
    };
}
