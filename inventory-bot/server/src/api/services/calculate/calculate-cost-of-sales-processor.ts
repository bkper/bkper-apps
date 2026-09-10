import type { Book, Transaction } from 'bkper-js';

export class CalculateCostOfSalesProcessor {
    private readonly inventoryBook: Book;
    private readonly financialBook: Book;

    private inventoryBookTransactionsToCreate = new Map<string, Transaction>();
    private inventoryBookTransactionsToUpdate = new Map<string, Transaction>();
    private financialBookTransactionsToCreate = new Map<string, Transaction>();

    private isAnyTransactionLocked = false;

    constructor(inventoryBook: Book, financialBook: Book) {
        this.inventoryBook = inventoryBook;
        this.financialBook = financialBook;
    }

    private getRemoteId(transaction: Transaction): string {
        const remoteIds = transaction.getRemoteIds();
        return remoteIds.length > 0 ? remoteIds[0]! : '';
    }

    generateId(): string {
        return `${crypto.randomUUID()}`;
    }

    private checkTransactionLocked(transaction: Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    setInventoryBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.inventoryBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
    }

    setInventoryBookTransactionToUpdate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.inventoryBookTransactionsToUpdate.set(transaction.getId()!, transaction);
    }

    setFinancialBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.financialBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
    }

    async fireBatchOperations(): Promise<void> {
        await this.fireBatchCreateInventoryBookTransactions();
        await this.fireBatchUpdateInventoryBookTransactions();
        await this.fireBatchCreateFinancialBookTransactions();
    }

    // Inventory book: create
    private async fireBatchCreateInventoryBookTransactions(): Promise<Transaction[]> {
        const batch = Array.from(this.inventoryBookTransactionsToCreate.values());
        if (batch.length > 0) {
            return this.inventoryBook.batchCreateTransactions(batch);
        }
        return [];
    }

    // Inventory book: update
    private async fireBatchUpdateInventoryBookTransactions(): Promise<void> {
        const batch = Array.from(this.inventoryBookTransactionsToUpdate.values());
        if (batch.length > 0) {
            await this.inventoryBook.batchUpdateTransactions(batch, true);
        }
    }

    // Financial book: create
    private async fireBatchCreateFinancialBookTransactions(): Promise<Transaction[]> {
        const batch = Array.from(this.financialBookTransactionsToCreate.values());
        if (batch.length > 0) {
            return this.financialBook.batchCreateTransactions(batch);
        }
        return [];
    }
}
