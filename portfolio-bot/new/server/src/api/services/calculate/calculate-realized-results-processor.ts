import { Amount, type Book, type Transaction } from 'bkper-js';
import { UNREALIZED_HIST_SUFFIX, UNREALIZED_SUFFIX } from '../../../shared/constants.js';

export class CalculateRealizedResultsProcessor {
    private portfolioBook: Book;
    private financialBook: Book;
    private baseBook: Book;

    private stockBookTransactionsToCreate = new Map<string, Transaction>();
    private stockBookTransactionsToUpdateMap = new Map<string, Transaction>();
    private financialBookTransactionsToCreateMap = new Map<string, Transaction>();
    private baseBookTransactionsToCreateMap = new Map<string, Transaction>();

    private mtmTransactionsSet = new Set<Transaction>();
    private mtmHistTransactionsSet = new Set<Transaction>();

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
        this.stockBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
    }

    setStockBookTransactionToUpdate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToUpdateMap.set(transaction.getId()!, transaction);
    }

    setFinancialBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.financialBookTransactionsToCreateMap.set(this.getRemoteId(transaction), transaction);
        if (this.isMtmTransaction(transaction)) {
            this.mtmTransactionsSet.add(transaction);
        }
        if (this.isMtmHistTransaction(transaction)) {
            this.mtmHistTransactionsSet.add(transaction);
        }
    }

    setBaseBookTransactionToCreate(transaction: Transaction): void {
        this.checkTransactionLocked(transaction);
        this.baseBookTransactionsToCreateMap.set(this.getRemoteId(transaction), transaction);
    }

    private getDateValue(isoDate: string): number {
        return +isoDate.replaceAll('-', '');
    }

    async getMtmBalance(onIsoDate: string): Promise<Amount> {
        let balance = new Amount(0);
        for (const mtmTransaction of Array.from(this.mtmTransactionsSet.values())) {
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
        for (const mtmHistTransaction of Array.from(this.mtmHistTransactionsSet.values())) {
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
        const newStockBookTransactions = await this.fireBatchCreateStockBookTransactions();

        for (const newStockBookTx of newStockBookTransactions) {
            const oldId = this.getTemporaryId(newStockBookTx);
            const newId = newStockBookTx.getId();

            const connectedRrTx = this.financialBookTransactionsToCreateMap.get(`${oldId}`);
            if (connectedRrTx) {
                connectedRrTx.addRemoteId(`${newId}`);
            }

            const connectedHistRrTx = this.financialBookTransactionsToCreateMap.get(
                `hist_${oldId}`
            );
            if (connectedHistRrTx) {
                connectedHistRrTx.addRemoteId(`hist_${newId}`);
            }

            const connectedFxTx = this.baseBookTransactionsToCreateMap.get(`fx_${oldId}`);
            if (connectedFxTx) {
                connectedFxTx.addRemoteId(`fx_${newId}`);
            }

            const connectedHistFxTx = this.baseBookTransactionsToCreateMap.get(`fx_hist_${oldId}`);
            if (connectedHistFxTx) {
                connectedHistFxTx.addRemoteId(`fx_hist_${newId}`);
            }

            const connectedMtmTx = this.financialBookTransactionsToCreateMap.get(`mtm_${oldId}`);
            if (connectedMtmTx) {
                connectedMtmTx.addRemoteId(`mtm_${newId}`);
            }

            const connectedHistMtmTx = this.financialBookTransactionsToCreateMap.get(
                `mtm_hist_${oldId}`
            );
            if (connectedHistMtmTx) {
                connectedHistMtmTx.addRemoteId(`mtm_hist_${newId}`);
            }
        }

        await this.fireBatchUpdateStockBookTransactions();
        await this.fireBatchCreateFinancialBookTransactions();
        await this.fireBatchCreateBaseBookTransactions();
    }

    private async fireBatchCreateStockBookTransactions(): Promise<Transaction[]> {
        const batch = Array.from(this.stockBookTransactionsToCreate.values());
        if (batch.length > 0) {
            return this.portfolioBook.batchCreateTransactions(batch);
        }
        return [];
    }

    private async fireBatchUpdateStockBookTransactions(): Promise<void> {
        const batch = Array.from(this.stockBookTransactionsToUpdateMap.values());
        if (batch.length > 0) {
            await this.portfolioBook.batchUpdateTransactions(batch, true);
        }
    }

    private async fireBatchCreateFinancialBookTransactions(): Promise<void> {
        const batch = Array.from(this.financialBookTransactionsToCreateMap.values());
        if (batch.length > 0) {
            await this.financialBook.batchCreateTransactions(batch);
        }
    }

    private async fireBatchCreateBaseBookTransactions(): Promise<void> {
        const batch = Array.from(this.baseBookTransactionsToCreateMap.values());
        if (batch.length > 0) {
            await this.baseBook.batchCreateTransactions(batch);
        }
    }
}
