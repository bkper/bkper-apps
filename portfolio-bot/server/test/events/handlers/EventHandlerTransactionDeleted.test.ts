import { afterEach, describe, expect, test } from 'bun:test';
import { AccountType, Bkper, Book, Transaction } from 'bkper-js';
import { EventHandlerTransactionDeleted } from '../../../src/events/handlers/EventHandlerTransactionDeleted.js';
import { InterceptorOrderProcessorDeleteFinancial } from '../../../src/events/interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { InterceptorOrderProcessorDeleteInstruments } from '../../../src/events/interceptors/InterceptorOrderProcessorDeleteInstruments.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalFinancialIntercept = InterceptorOrderProcessorDeleteFinancial.prototype.intercept;
const originalInstrumentIntercept = InterceptorOrderProcessorDeleteInstruments.prototype.intercept;

afterEach(() => {
    InterceptorOrderProcessorDeleteFinancial.prototype.intercept = originalFinancialIntercept;
    InterceptorOrderProcessorDeleteInstruments.prototype.intercept = originalInstrumentIntercept;
});

function createTransaction(): bkper.Transaction {
    return {
        id: 'transaction-1',
        posted: true,
        date: '2024-01-02',
        amount: '10',
        creditAccount: { id: 'origin', name: 'Origin', type: AccountType.ASSET },
        debitAccount: { id: 'destination', name: 'Destination', type: AccountType.ASSET },
        properties: {},
    };
}

function createEvent(book: Book): bkper.Event {
    return {
        type: 'TRANSACTION_DELETED',
        bookId: book.getId(),
        user: { username: 'tester' },
        agent: { id: 'user' },
        data: { object: { transaction: createTransaction() } },
    };
}

function createHandler(book: Book): EventHandlerTransactionDeleted {
    const bkper = new Bkper();
    bkper.getBook = async () => book;
    return new EventHandlerTransactionDeleted(
        new AppContext(bkper, {
            ASSETS: { fetch },
        })
    );
}

class ConnectedDeletionHandler extends EventHandlerTransactionDeleted {
    runConnectedDeletion(
        stockBook: Book,
        stockTransaction: Transaction,
        operations: string[]
    ): Promise<string> {
        this.botService.flagStockAccountForRebuildIfNeeded = async () => {
            operations.push('rebuild');
        };
        return this.connectedTransactionFound(
            stockBook,
            stockBook,
            createTransaction(),
            stockTransaction,
            'USD'
        );
    }
}

describe('legacy deleted transaction behavior', () => {
    test('selects the Portfolio or Financial deletion interceptor from the event Book', async () => {
        const calls: string[] = [];
        InterceptorOrderProcessorDeleteInstruments.prototype.intercept = async () => {
            calls.push('portfolio');
            return { result: 'portfolio-deleted' };
        };
        InterceptorOrderProcessorDeleteFinancial.prototype.intercept = async () => {
            calls.push('financial');
            return { result: 'financial-deleted' };
        };
        const portfolioBook = new Book({
            id: 'portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        });
        const financialBook = new Book({
            id: 'financial',
            fractionDigits: 2,
            properties: { exc_code: 'USD' },
        });

        const portfolioResult = await createHandler(portfolioBook).handleEvent(
            createEvent(portfolioBook)
        );
        const financialResult = await createHandler(financialBook).handleEvent(
            createEvent(financialBook)
        );

        expect(calls).toEqual(['portfolio', 'financial']);
        expect(portfolioResult).toEqual({ result: 'portfolio-deleted' });
        expect(financialResult).toEqual({ result: 'financial-deleted' });
    });

    test('awaits uncheck, rebuild flagging, and trash for a connected fallback movement', async () => {
        const stockBook = new Book({
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            decimalSeparator: 'DOT',
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
        });
        const stockTransaction = new Transaction(stockBook, {
            ...createTransaction(),
            checked: true,
        });
        const operations: string[] = [];
        stockTransaction.uncheck = async () => {
            operations.push('uncheck');
            stockTransaction.setChecked(false);
            return stockTransaction;
        };
        stockTransaction.trash = async () => {
            operations.push('trash');
            return stockTransaction;
        };
        stockTransaction.getCreditAccountName = async () => 'Origin';
        stockTransaction.getDebitAccountName = async () => 'Destination';
        const handler = new ConnectedDeletionHandler(
            new AppContext(new Bkper(), { ASSETS: { fetch } })
        );

        const response = await handler.runConnectedDeletion(
            stockBook,
            stockTransaction,
            operations
        );

        expect(operations).toEqual(['uncheck', 'rebuild', 'trash']);
        expect(response).toContain('DELETED:');
    });
});
