import { Amount, type Book, type Transaction } from 'bkper-js';
import { UNREALIZED_HIST_SUFFIX, UNREALIZED_SUFFIX } from '../../../shared/constants.js';

export class CalculateRealizedResultsProcessor {
    private portfolioBook: Book;
    private financialBook: Book;
    private baseBook: Book;

    private stockBookTransactionsToCreate = new Map<string, Transaction>();
    private stockBookTransactionsToUpdate = new Map<string, Transaction>();
    private financialBookTransactionsToCreate = new Map<string, Transaction>();
    private baseBookTransactionsToCreate = new Map<string, Transaction>();

    private mtmTransactions = new Set<Transaction>();
    private mtmHistTransactions = new Set<Transaction>();

    private isAnyTransactionLocked = false;

    constructor(portfolioBook: Book, financialBook: Book, baseBook: Book) {
        this.portfolioBook = portfolioBook;
        this.financialBook = financialBook;
        this.baseBook = baseBook;
    }

    generateTemporaryId(): string {
        return `crrp_id_${crypto.randomUUID()}`;
    }

    getTemporaryId(transaction: Transaction): string {
        for (const remoteId of transaction.getRemoteIds()) {
            if (remoteId.startsWith('crrp_id_')) {
                return remoteId;
            }
        }
        return '';
    }

    private getRemoteId(transaction: Transaction): string {
        const remoteIds = transaction.getRemoteIds();
        return remoteIds.length > 0 ? remoteIds[0]! : '';
    }

    private isMtmTransaction(transaction: Transaction): boolean {
        const remoteId = this.getRemoteId(transaction);
        if (remoteId && remoteId.startsWith('mtm_') && !remoteId.startsWith('mtm_hist_')) {
            return true;
        }
        return false;
    }

    private isMtmHistTransaction(transaction: Transaction): boolean {
        const remoteId = this.getRemoteId(transaction);
        if (remoteId && remoteId.startsWith('mtm_hist_')) {
            return true;
        }
        return false;
    }

    private checkTransactionLocked(transaction: Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    setStockBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.stockBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
    }

    setStockBookTransactionToUpdate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToUpdate.set(transaction.getId()!, transaction);
    }

    setFinancialBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.financialBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
        // Store MTM transaction
        if (this.isMtmTransaction(transaction)) {
            this.mtmTransactions.add(transaction);
        }
        // Store MTM Hist transaction
        if (this.isMtmHistTransaction(transaction)) {
            this.mtmHistTransactions.add(transaction);
        }
    }

    setBaseBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.baseBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
    }

    private getDateValue(isoDate: string): number {
        return +isoDate.replaceAll('-', '');
    }

    async getMtmBalance(onIsoDate: string): Promise<Amount> {
        let balance = new Amount(0);
        for (const mtmTransaction of Array.from(this.mtmTransactions.values())) {
            if (this.getDateValue(mtmTransaction.getDate()!) <= this.getDateValue(onIsoDate)) {
                const debitAccountName = (await mtmTransaction.getDebitAccountName())!;
                const amount = debitAccountName.endsWith(` ${UNREALIZED_SUFFIX}`)
                    ? mtmTransaction.getAmount()!.times(-1)
                    : mtmTransaction.getAmount()!;
                balance = balance.plus(amount);
            }
        }
        return balance;
    }

    async getHistMtmBalance(onIsoDate: string): Promise<Amount> {
        let balance = new Amount(0);
        for (const mtmHistTransaction of Array.from(this.mtmHistTransactions.values())) {
            if (this.getDateValue(mtmHistTransaction.getDate()!) <= this.getDateValue(onIsoDate)) {
                const debitAccountName = (await mtmHistTransaction.getDebitAccountName())!;
                const amount = debitAccountName.endsWith(` ${UNREALIZED_HIST_SUFFIX}`)
                    ? mtmHistTransaction.getAmount()!.times(-1)
                    : mtmHistTransaction.getAmount()!;
                balance = balance.plus(amount);
            }
        }
        return balance;
    }

    async fireBatchOperations(): Promise<void> {
        // Fire batch creation of stock book transactions first in order to get new ids
        const newStockBookTransactions = await this.fireBatchCreateStockBookTransactions();

        // Fix remoteIds references on RR, FX and MTM transactions
        for (const newStockBookTx of newStockBookTransactions) {
            const oldId = this.getTemporaryId(newStockBookTx);
            const newId = newStockBookTx.getId();

            // RR
            const connectedRrTx = this.financialBookTransactionsToCreate.get(`${oldId}`);
            if (connectedRrTx) {
                connectedRrTx.addRemoteId(`${newId}`);
            }

            // RR Hist
            const connectedHistRrTx = this.financialBookTransactionsToCreate.get(`hist_${oldId}`);
            if (connectedHistRrTx) {
                connectedHistRrTx.addRemoteId(`hist_${newId}`);
            }

            // FX
            const connectedFxTx = this.baseBookTransactionsToCreate.get(`fx_${oldId}`);
            if (connectedFxTx) {
                connectedFxTx.addRemoteId(`fx_${newId}`);
            }

            // FX Hist
            const connectedHistFxTx = this.baseBookTransactionsToCreate.get(`fx_hist_${oldId}`);
            if (connectedHistFxTx) {
                connectedHistFxTx.addRemoteId(`fx_hist_${newId}`);
            }

            // MTM
            const connectedMtmTx = this.financialBookTransactionsToCreate.get(`mtm_${oldId}`);
            if (connectedMtmTx) {
                connectedMtmTx.addRemoteId(`mtm_${newId}`);
            }

            // MTM Hist
            const connectedHistMtmTx = this.financialBookTransactionsToCreate.get(
                `mtm_hist_${oldId}`
            );
            if (connectedHistMtmTx) {
                connectedHistMtmTx.addRemoteId(`mtm_hist_${newId}`);
            }
        }

        // Fire other batch operations
        await this.fireBatchUpdateStockBookTransactions();
        await this.fireBatchCreateFinancialBookTransactions();
        await this.fireBatchCreateBaseBookTransactions();
    }

    // Stock book: create
    private async fireBatchCreateStockBookTransactions(): Promise<Transaction[]> {
        const batch = Array.from(this.stockBookTransactionsToCreate.values());
        if (batch.length > 0) {
            return this.portfolioBook.batchCreateTransactions(batch);
        }
        return [];
    }

    // Stock book: update
    private async fireBatchUpdateStockBookTransactions(): Promise<void> {
        const batch = Array.from(this.stockBookTransactionsToUpdate.values());
        if (batch.length > 0) {
            await this.portfolioBook.batchUpdateTransactions(batch, true);
        }
    }

    // Financial book: create
    private async fireBatchCreateFinancialBookTransactions(): Promise<void> {
        const batch = Array.from(this.financialBookTransactionsToCreate.values());
        if (batch.length > 0) {
            await this.financialBook.batchCreateTransactions(batch);
        }
    }

    // Base book: create
    private async fireBatchCreateBaseBookTransactions(): Promise<void> {
        const batch = Array.from(this.baseBookTransactionsToCreate.values());
        if (batch.length > 0) {
            await this.baseBook.batchCreateTransactions(batch);
        }
    }
}
