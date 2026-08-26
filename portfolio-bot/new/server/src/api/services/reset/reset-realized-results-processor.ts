import type { Book, Transaction } from 'bkper-js';

export class ResetRealizedResultsProcessor {
    private portfolioBook: Book;
    private financialBook: Book;
    private baseBook: Book;

    private stockBookTransactionsToUpdate = new Map<string, Transaction>();
    private stockBookTransactionsToTrash = new Map<string, Transaction>();
    private financialBookTransactionsToTrash = new Map<string, Transaction>();
    private baseBookTransactionsToTrash = new Map<string, Transaction>();

    private isAnyTransactionLocked = false;

    constructor(portfolioBook: Book, financialBook: Book, baseBook: Book) {
        this.portfolioBook = portfolioBook;
        this.financialBook = financialBook;
        this.baseBook = baseBook;
    }

    private checkTransactionLocked(transaction: Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    setStockBookTransactionToUpdate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToUpdate.set(transaction.getId()!, transaction);
    }

    setStockBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToTrash.set(transaction.getId()!, transaction);
    }

    setFinancialBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.financialBookTransactionsToTrash.set(transaction.getId()!, transaction);
    }

    setBaseBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.baseBookTransactionsToTrash.set(transaction.getId()!, transaction);
    }

    async fireBatchOperations(): Promise<void> {
        await this.fireBatchUpdateStockBookTransactions();
        await this.fireBatchTrashStockBookTransactions();
        await this.fireBatchTrashFinancialBookTransactions();
        await this.fireBatchTrashBaseBookTransactions();
    }

    private async fireBatchUpdateStockBookTransactions(): Promise<void> {
        const batch = Array.from(this.stockBookTransactionsToUpdate.values());
        if (batch.length > 0) {
            await this.portfolioBook.batchUpdateTransactions(batch, true);
        }
    }

    private async fireBatchTrashStockBookTransactions(): Promise<void> {
        const batch = Array.from(this.stockBookTransactionsToTrash.values());
        if (batch.length > 0) {
            await this.portfolioBook.batchTrashTransactions(batch, true);
        }
    }

    private async fireBatchTrashFinancialBookTransactions(): Promise<void> {
        const batch = Array.from(this.financialBookTransactionsToTrash.values());
        if (batch.length > 0) {
            await this.financialBook.batchTrashTransactions(batch, true);
        }
    }

    private async fireBatchTrashBaseBookTransactions(): Promise<void> {
        const batch = Array.from(this.baseBookTransactionsToTrash.values());
        if (batch.length > 0) {
            await this.baseBook.batchTrashTransactions(batch, true);
        }
    }
}
