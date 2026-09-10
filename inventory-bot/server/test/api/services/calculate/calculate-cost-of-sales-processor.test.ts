import { describe, expect, test } from 'bun:test';
import { Book, Transaction } from 'bkper-js';
import { CalculateCostOfSalesProcessor } from '../../../../src/api/services/calculate/calculate-cost-of-sales-processor.js';

interface BatchCall {
    phase: string;
    transactions: Transaction[];
    includeChecked?: boolean;
}

function createTransaction(
    book: Book,
    id: string | undefined,
    remoteId?: string,
    locked = false
): Transaction {
    const transaction = new Transaction(book, { id });
    if (remoteId) {
        transaction.addRemoteId(remoteId);
    }
    transaction.isLocked = () => locked;
    return transaction;
}

describe('legacy CalculateCostOfSalesProcessor', () => {
    test('deduplicates and fires Inventory create, Inventory update, then Financial create', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const calls: BatchCall[] = [];
        inventoryBook.batchCreateTransactions = async transactions => {
            calls.push({ phase: 'inventory-create', transactions });
            return transactions;
        };
        inventoryBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'inventory-update', transactions, includeChecked });
            return transactions;
        };
        financialBook.batchCreateTransactions = async transactions => {
            calls.push({ phase: 'financial-create', transactions });
            return transactions;
        };
        const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);
        const replacedCreate = createTransaction(inventoryBook, undefined, 'create-1');
        const replacementCreate = createTransaction(inventoryBook, undefined, 'create-1');
        const retainedUpdate = createTransaction(inventoryBook, 'update-2');
        const replacedUpdate = createTransaction(inventoryBook, 'update-1');
        const replacementUpdate = createTransaction(inventoryBook, 'update-1');
        const financialCreate = createTransaction(financialBook, undefined, 'financial-1');

        processor.setInventoryBookTransactionToCreate(replacedCreate);
        processor.setInventoryBookTransactionToCreate(replacementCreate);
        processor.setInventoryBookTransactionToUpdate(replacedUpdate);
        processor.setInventoryBookTransactionToUpdate(retainedUpdate);
        processor.setInventoryBookTransactionToUpdate(replacementUpdate);
        processor.setFinancialBookTransactionToCreate(financialCreate);

        await processor.fireBatchOperations();

        expect(calls.map(call => call.phase)).toEqual([
            'inventory-create',
            'inventory-update',
            'financial-create',
        ]);
        expect(calls[0]?.transactions).toEqual([replacementCreate]);
        expect(calls[1]?.transactions).toEqual([replacementUpdate, retainedUpdate]);
        expect(calls[1]?.includeChecked).toBe(true);
        expect(calls[2]?.transactions).toEqual([financialCreate]);
    });

    test('detects a lock in every queue and skips empty phases', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const setters: Array<
            (processor: CalculateCostOfSalesProcessor, transaction: Transaction) => void
        > = [
            (processor, transaction) => processor.setInventoryBookTransactionToCreate(transaction),
            (processor, transaction) => processor.setInventoryBookTransactionToUpdate(transaction),
            (processor, transaction) => processor.setFinancialBookTransactionToCreate(transaction),
        ];

        for (const setter of setters) {
            const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);
            expect(processor.hasLockedTransaction()).toBe(false);
            setter(processor, createTransaction(inventoryBook, 'locked', 'locked', true));
            expect(processor.hasLockedTransaction()).toBe(true);
        }

        inventoryBook.batchCreateTransactions = async () => {
            throw new Error('Unexpected Inventory create');
        };
        inventoryBook.batchUpdateTransactions = async () => {
            throw new Error('Unexpected Inventory update');
        };
        financialBook.batchCreateTransactions = async () => {
            throw new Error('Unexpected Financial create');
        };
        await expect(
            new CalculateCostOfSalesProcessor(inventoryBook, financialBook).fireBatchOperations()
        ).resolves.toBeUndefined();
    });

    test('waits for a failed phase and does not start later writes', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const calls: string[] = [];
        const error = new Error('Inventory create failed');
        inventoryBook.batchCreateTransactions = async () => {
            calls.push('inventory-create');
            throw error;
        };
        inventoryBook.batchUpdateTransactions = async transactions => {
            calls.push('inventory-update');
            return transactions;
        };
        financialBook.batchCreateTransactions = async transactions => {
            calls.push('financial-create');
            return transactions;
        };
        const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);
        processor.setInventoryBookTransactionToCreate(
            createTransaction(inventoryBook, undefined, 'create')
        );
        processor.setInventoryBookTransactionToUpdate(createTransaction(inventoryBook, 'update'));
        processor.setFinancialBookTransactionToCreate(
            createTransaction(financialBook, undefined, 'financial')
        );

        await expect(processor.fireBatchOperations()).rejects.toBe(error);
        expect(calls).toEqual(['inventory-create']);
    });

    test('generates UUID values for split relationships', () => {
        const processor = new CalculateCostOfSalesProcessor(
            new Book({ id: 'inventory-book' }),
            new Book({ id: 'financial-book' })
        );

        expect(processor.generateId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
    });
});
