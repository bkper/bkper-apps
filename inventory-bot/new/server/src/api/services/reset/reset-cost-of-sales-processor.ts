import type { Book, Transaction } from 'bkper-js';

export class ResetCostOfSalesProcessor {
    private inventoryBook: Book;
    private financialBook: Book;

    private financialBookTransactionsToTrash = new Map<string, Transaction>();
    private inventoryBookTransactionsToUpdate = new Map<string, Transaction>();
    private inventoryBookTransactionsToTrash = new Map<string, Transaction>();

    private isAnyTransactionLocked = false;

    constructor(inventoryBook: Book, financialBook: Book) {
        this.inventoryBook = inventoryBook;
        this.financialBook = financialBook;
    }

    setFinancialBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.financialBookTransactionsToTrash.set(transaction.getId()!, transaction);
    }

    setInventoryBookTransactionToUpdate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.inventoryBookTransactionsToUpdate.set(transaction.getId()!, transaction);
    }

    setInventoryBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.inventoryBookTransactionsToTrash.set(transaction.getId()!, transaction);
    }

    private checkTransactionLocked(transaction: Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    async fireBatchOperations(): Promise<void> {
        await this.fireBatchTrashFinancialBookTransactions();
        await this.fireBatchUpdateInventoryBookTransactions();
        await this.fireBatchTrashInventoryBookTransactions();
    }

    // Financial book: trash
    private async fireBatchTrashFinancialBookTransactions(): Promise<void> {
        const batch = Array.from(this.financialBookTransactionsToTrash.values());
        if (batch.length > 0) {
            await this.financialBook.batchTrashTransactions(batch, true);
        }
    }

    // Inventory book: update
    private async fireBatchUpdateInventoryBookTransactions(): Promise<void> {
        const batch = Array.from(this.inventoryBookTransactionsToUpdate.values());
        if (batch.length > 0) {
            await this.inventoryBook.batchUpdateTransactions(batch, true);
        }
    }

    // Inventory book: trash
    private async fireBatchTrashInventoryBookTransactions(): Promise<void> {
        const batch = Array.from(this.inventoryBookTransactionsToTrash.values());
        if (batch.length > 0) {
            await this.inventoryBook.batchTrashTransactions(batch, true);
        }
    }
}
