import { afterEach, describe, expect, test } from 'bun:test';
import { AccountType, Bkper, Book } from 'bkper-js';
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
});
