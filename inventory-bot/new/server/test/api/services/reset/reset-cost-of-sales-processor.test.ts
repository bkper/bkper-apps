import { describe, expect, test } from 'bun:test';
import { Book, Transaction } from 'bkper-js';
import { ResetCostOfSalesProcessor } from '../../../../src/api/services/reset/reset-cost-of-sales-processor.js';

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

describe('legacy ResetCostOfSalesProcessor', () => {
    test('deduplicates by Transaction id and fires the three phases in legacy order', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const calls: BatchCall[] = [];
        financialBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'financial-trash', transactions, includeChecked });
        };
        inventoryBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'inventory-update', transactions, includeChecked });
            return transactions;
        };
        inventoryBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'inventory-trash', transactions, includeChecked });
        };
        const processor = new ResetCostOfSalesProcessor(inventoryBook, financialBook);
        const replaced = createTransaction(inventoryBook, 'update-1');
        const retained = createTransaction(inventoryBook, 'update-2');
        const replacement = createTransaction(inventoryBook, 'update-1');
        const financialTrash = createTransaction(financialBook, 'financial-trash');
        const inventoryTrash = createTransaction(inventoryBook, 'inventory-trash');

        processor.setInventoryBookTransactionToUpdate(replaced);
        processor.setInventoryBookTransactionToUpdate(retained);
        processor.setInventoryBookTransactionToUpdate(replacement);
        processor.setFinancialBookTransactionToTrash(financialTrash);
        processor.setInventoryBookTransactionToTrash(inventoryTrash);

        await processor.fireBatchOperations();

        expect(calls.map(call => call.phase)).toEqual([
            'financial-trash',
            'inventory-update',
            'inventory-trash',
        ]);
        expect(calls.every(call => call.includeChecked === true)).toBe(true);
        expect(calls[1]?.transactions).toEqual([replacement, retained]);
    });

    test('checks every queued Transaction for a lock without firing writes', () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const setters: Array<
            (processor: ResetCostOfSalesProcessor, transaction: Transaction) => void
        > = [
            (processor, transaction) => processor.setFinancialBookTransactionToTrash(transaction),
            (processor, transaction) => processor.setInventoryBookTransactionToUpdate(transaction),
            (processor, transaction) => processor.setInventoryBookTransactionToTrash(transaction),
        ];

        for (const setter of setters) {
            const processor = new ResetCostOfSalesProcessor(inventoryBook, financialBook);
            expect(processor.hasLockedTransaction()).toBe(false);
            setter(processor, createTransaction(inventoryBook, 'locked', true));
            expect(processor.hasLockedTransaction()).toBe(true);
        }
    });

    test('skips empty phases', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        inventoryBook.batchUpdateTransactions = async () => {
            throw new Error('Unexpected Inventory update');
        };
        inventoryBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Inventory trash');
        };
        financialBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Financial trash');
        };

        await expect(
            new ResetCostOfSalesProcessor(inventoryBook, financialBook).fireBatchOperations()
        ).resolves.toBeUndefined();
    });

    test('waits for a failed phase and does not start later writes', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const calls: string[] = [];
        const error = new Error('Financial trash failed');
        financialBook.batchTrashTransactions = async () => {
            calls.push('financial-trash');
            throw error;
        };
        inventoryBook.batchUpdateTransactions = async transactions => {
            calls.push('inventory-update');
            return transactions;
        };
        inventoryBook.batchTrashTransactions = async () => {
            calls.push('inventory-trash');
        };
        const processor = new ResetCostOfSalesProcessor(inventoryBook, financialBook);
        processor.setFinancialBookTransactionToTrash(
            createTransaction(financialBook, 'financial-trash')
        );
        processor.setInventoryBookTransactionToUpdate(
            createTransaction(inventoryBook, 'inventory-update')
        );
        processor.setInventoryBookTransactionToTrash(
            createTransaction(inventoryBook, 'inventory-trash')
        );

        await expect(processor.fireBatchOperations()).rejects.toBe(error);
        expect(calls).toEqual(['financial-trash']);
    });
});
