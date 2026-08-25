import { describe, expect, test } from 'bun:test';
import { Book, Transaction } from 'bkper-js';
import { ResetRealizedResultsProcessor } from '../../../../src/api/services/reset/reset-realized-results-processor.js';

interface BatchCall {
    phase: string;
    transactions: Transaction[];
    includeChecked: boolean | undefined;
}

function createTransaction(book: Book, id: string, locked = false): Transaction {
    const transaction = new Transaction(book, { id });
    transaction.isLocked = () => locked;
    return transaction;
}

function createBooks(): { stockBook: Book; financialBook: Book; baseBook: Book } {
    return {
        stockBook: new Book({ id: 'portfolio-book' }),
        financialBook: new Book({ id: 'financial-book' }),
        baseBook: new Book({ id: 'base-book' }),
    };
}

describe('legacy ResetRealizedResultsProcessor', () => {
    test('deduplicates by Transaction id and fires the four phases in legacy order', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const calls: BatchCall[] = [];
        stockBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'portfolio-update', transactions, includeChecked });
            return transactions;
        };
        stockBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'portfolio-trash', transactions, includeChecked });
        };
        financialBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'financial-trash', transactions, includeChecked });
        };
        baseBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'base-trash', transactions, includeChecked });
        };
        const processor = new ResetRealizedResultsProcessor(stockBook, financialBook, baseBook);
        const replacedUpdate = createTransaction(stockBook, 'portfolio-update-1');
        const retainedUpdate = createTransaction(stockBook, 'portfolio-update-2');
        const replacementUpdate = createTransaction(stockBook, 'portfolio-update-1');
        const portfolioTrash = createTransaction(stockBook, 'portfolio-trash');
        const financialTrash = createTransaction(financialBook, 'financial-trash');
        const baseTrash = createTransaction(baseBook, 'base-trash');

        processor.setStockBookTransactionToUpdate(replacedUpdate);
        processor.setStockBookTransactionToUpdate(retainedUpdate);
        processor.setStockBookTransactionToUpdate(replacementUpdate);
        processor.setStockBookTransactionToTrash(portfolioTrash);
        processor.setFinancialBookTransactionToTrash(financialTrash);
        processor.setBaseBookTransactionToTrash(baseTrash);

        await expect(processor.fireBatchOperations()).resolves.toBeUndefined();
        expect(calls.map(call => call.phase)).toEqual([
            'portfolio-update',
            'portfolio-trash',
            'financial-trash',
            'base-trash',
        ]);
        expect(calls.every(call => call.includeChecked === true)).toBe(true);
        expect(calls[0]?.transactions).toEqual([replacementUpdate, retainedUpdate]);
    });

    test('checks every queued Transaction for a lock without firing writes', () => {
        const setters: Array<
            (processor: ResetRealizedResultsProcessor, transaction: Transaction) => void
        > = [
            (processor, transaction) => processor.setStockBookTransactionToUpdate(transaction),
            (processor, transaction) => processor.setStockBookTransactionToTrash(transaction),
            (processor, transaction) => processor.setFinancialBookTransactionToTrash(transaction),
            (processor, transaction) => processor.setBaseBookTransactionToTrash(transaction),
        ];

        for (const setTransaction of setters) {
            const { stockBook, financialBook, baseBook } = createBooks();
            const processor = new ResetRealizedResultsProcessor(stockBook, financialBook, baseBook);

            expect(processor.hasLockedTransaction()).toBe(false);
            setTransaction(processor, createTransaction(stockBook, 'locked', true));
            expect(processor.hasLockedTransaction()).toBe(true);
        }
    });

    test('skips empty phases', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        stockBook.batchUpdateTransactions = async () => {
            throw new Error('Unexpected Portfolio update');
        };
        stockBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Portfolio trash');
        };
        financialBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Financial trash');
        };
        baseBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Base trash');
        };
        const processor = new ResetRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await expect(processor.fireBatchOperations()).resolves.toBeUndefined();
    });

    test('waits for a failed phase and does not start later writes', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const calls: string[] = [];
        const updateError = new Error('Portfolio update failed');
        let rejectUpdate: ((reason: Error) => void) | undefined;
        stockBook.batchUpdateTransactions = async () => {
            calls.push('portfolio-update');
            return new Promise<Transaction[]>((_resolve, reject) => {
                rejectUpdate = reject;
            });
        };
        stockBook.batchTrashTransactions = async () => {
            calls.push('portfolio-trash');
        };
        financialBook.batchTrashTransactions = async () => {
            calls.push('financial-trash');
        };
        baseBook.batchTrashTransactions = async () => {
            calls.push('base-trash');
        };
        const processor = new ResetRealizedResultsProcessor(stockBook, financialBook, baseBook);
        processor.setStockBookTransactionToUpdate(createTransaction(stockBook, 'portfolio-update'));
        processor.setStockBookTransactionToTrash(createTransaction(stockBook, 'portfolio-trash'));
        processor.setFinancialBookTransactionToTrash(
            createTransaction(financialBook, 'financial-trash')
        );
        processor.setBaseBookTransactionToTrash(createTransaction(baseBook, 'base-trash'));

        const result = processor.fireBatchOperations();
        expect(calls).toEqual(['portfolio-update']);
        if (!rejectUpdate) {
            throw new Error('Expected Portfolio update to start');
        }
        rejectUpdate(updateError);

        await expect(result).rejects.toBe(updateError);
        expect(calls).toEqual(['portfolio-update']);
    });
});
