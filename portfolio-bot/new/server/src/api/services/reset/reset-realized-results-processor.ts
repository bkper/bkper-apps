import type { Book, Transaction } from 'bkper-js';

export class ResetRealizedResultsProcessor {
    private portfolioBook: Book;
    private financialBook: Book;
    private baseBook: Book;

    private stockBookTransactionsToUpdateMap = new Map<string, Transaction>();
    private stockBookTransactionsToTrashMap = new Map<string, Transaction>();
    private financialBookTransactionsToTrashMap = new Map<string, Transaction>();
    private baseBookTransactionsToTrashMap = new Map<string, Transaction>();

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
        this.stockBookTransactionsToUpdateMap.set(transaction.getId()!, transaction);
    }

    setStockBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToTrashMap.set(transaction.getId()!, transaction);
    }

    setFinancialBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.financialBookTransactionsToTrashMap.set(transaction.getId()!, transaction);
    }

    setBaseBookTransactionToTrash(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.baseBookTransactionsToTrashMap.set(transaction.getId()!, transaction);
    }

    async fireBatchOperations(): Promise<void> {
        await this.fireBatchUpdateStockBookTransactions();
        await this.fireBatchTrashStockBookTransactions();
        await this.fireBatchTrashFinancialBookTransactions();
        await this.fireBatchTrashBaseBookTransactions();
    }

    private async fireBatchUpdateStockBookTransactions(): Promise<void> {
        const batch = Array.from(this.stockBookTransactionsToUpdateMap.values());
        if (batch.length > 0) {
            await this.portfolioBook.batchUpdateTransactions(batch, true);
        }
    }

    private async fireBatchTrashStockBookTransactions(): Promise<void> {
        const batch = Array.from(this.stockBookTransactionsToTrashMap.values());
        if (batch.length > 0) {
            await this.portfolioBook.batchTrashTransactions(batch, true);
        }
    }

    private async fireBatchTrashFinancialBookTransactions(): Promise<void> {
        const batch = Array.from(this.financialBookTransactionsToTrashMap.values());
        if (batch.length > 0) {
            await this.financialBook.batchTrashTransactions(batch, true);
        }
    }

    private async fireBatchTrashBaseBookTransactions(): Promise<void> {
        const batch = Array.from(this.baseBookTransactionsToTrashMap.values());
        if (batch.length > 0) {
            await this.baseBook.batchTrashTransactions(batch, true);
        }
    }
}
