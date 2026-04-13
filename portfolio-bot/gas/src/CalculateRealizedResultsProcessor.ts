class CalculateRealizedResultsProcessor {

    private stockBook: Bkper.Book;
    private financialBook: Bkper.Book;
    private baseBook: Bkper.Book;

    private stockBookTransactionsToCreate = new Map<string, Bkper.Transaction>();
    private stockBookTransactionsToUpdateMap = new Map<string, Bkper.Transaction>();
    private financialBookTransactionsToCreateMap = new Map<string, Bkper.Transaction>();
    private baseBookTransactionsToCreateMap = new Map<string, Bkper.Transaction>();

    private mtmTransactionsSet = new Set<Bkper.Transaction>();
    private mtmHistTransactionsSet = new Set<Bkper.Transaction>();

    private isAnyTransactionLocked = false;

    constructor(stockBook: Bkper.Book, financialBook: Bkper.Book, baseBook: Bkper.Book) {
        this.stockBook = stockBook;
        this.financialBook = financialBook;
        this.baseBook = baseBook;
    }

    generateTemporaryId(): string {
        return `crrp_id_${Utilities.getUuid()}`;
    }

    getTemporaryId(transaction: Bkper.Transaction): string {
        for (const remoteId of transaction.getRemoteIds()) {
            if (remoteId.startsWith('crrp_id_')) {
                return remoteId;
            }
        }
        return '';
    }

    private getRemoteId(transaction: Bkper.Transaction): string {
        const remoteIds = transaction.getRemoteIds();
        return remoteIds.length > 0 ? remoteIds[0] : '';
    }

    private isMtmTransaction(transaction: Bkper.Transaction): boolean {
        const remoteId = this.getRemoteId(transaction);
        if (remoteId && remoteId.startsWith('mtm_') && !remoteId.startsWith('mtm_hist_')) {
            return true;
        }
        return false;
    }

    private isMtmHistTransaction(transaction: Bkper.Transaction): boolean {
        const remoteId = this.getRemoteId(transaction);
        if (remoteId && remoteId.startsWith('mtm_hist_')) {
            return true;
        }
        return false;
    }

    private checkTransactionLocked(transaction: Bkper.Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    setStockBookTransactionToCreate(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.stockBookTransactionsToCreate.set(this.getRemoteId(transaction), transaction);
    }

    setStockBookTransactionToUpdate(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToUpdateMap.set(transaction.getId(), transaction);
    }

    setFinancialBookTransactionToCreate(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.financialBookTransactionsToCreateMap.set(this.getRemoteId(transaction), transaction);
        // Store MTM transaction
        if (this.isMtmTransaction(transaction)) {
            this.mtmTransactionsSet.add(transaction);
        }
        // Store MTM Hist transaction
        if (this.isMtmHistTransaction(transaction)) {
            this.mtmHistTransactionsSet.add(transaction);
        }
    }

    setBaseBookTransactionToCreate(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        // Use remoteId as key since transaction does not have an id yet
        this.baseBookTransactionsToCreateMap.set(this.getRemoteId(transaction), transaction);
    }

    private getDateValue(isoDate: string): number {
        return +(isoDate.replaceAll('-', ''));
    }

    getMtmBalance(onIsoDate: string): Bkper.Amount {
        let balance = BkperApp.newAmount(0);
        for (const mtmTransaction of Array.from(this.mtmTransactionsSet.values())) {
            if (this.getDateValue(mtmTransaction.getDate()) <= this.getDateValue(onIsoDate)) {
                const amount = mtmTransaction.getDebitAccountName().endsWith(` ${UNREALIZED_SUFFIX}`) ? mtmTransaction.getAmount().times(-1) : mtmTransaction.getAmount();
                balance = balance.plus(amount);
            }
        }
        return balance;
    }

    getHistMtmBalance(onIsoDate: string): Bkper.Amount {
        let balance = BkperApp.newAmount(0);
        for (const mtmHistTransaction of Array.from(this.mtmHistTransactionsSet.values())) {
            if (this.getDateValue(mtmHistTransaction.getDate()) <= this.getDateValue(onIsoDate)) {
                const amount = mtmHistTransaction.getDebitAccountName().endsWith(` ${UNREALIZED_HIST_SUFFIX}`) ? mtmHistTransaction.getAmount().times(-1) : mtmHistTransaction.getAmount();
                balance = balance.plus(amount);
            }
        }
        return balance;
    }

    fireBatchOperations(): void {

        // Fire batch creation of stock book transactions first in order to get new ids
        const newStockBookTransactions = this.fireBatchCreateStockBookTransactions();

        // Fix remoteIds references on RR, FX and MTM transactions
        for (const newStockBookTx of newStockBookTransactions) {

            const oldId = this.getTemporaryId(newStockBookTx);
            const newId = newStockBookTx.getId();

            // RR
            const connectedRrTx = this.financialBookTransactionsToCreateMap.get(`${oldId}`);
            if (connectedRrTx) {
                connectedRrTx.addRemoteId(`${newId}`);
            }
            // RR Hist
            const connectedHistRrTx = this.financialBookTransactionsToCreateMap.get(`hist_${oldId}`);
            if (connectedHistRrTx) {
                connectedHistRrTx.addRemoteId(`hist_${newId}`);
            }

            // FX
            const connectedFxTx = this.baseBookTransactionsToCreateMap.get(`fx_${oldId}`);
            if (connectedFxTx) {
                connectedFxTx.addRemoteId(`fx_${newId}`);
            }
            // FX Hist
            const connectedHistFxTx = this.baseBookTransactionsToCreateMap.get(`fx_hist_${oldId}`);
            if (connectedHistFxTx) {
                connectedHistFxTx.addRemoteId(`fx_hist_${newId}`);
            }

            // MTM
            const connectedMtmTx = this.financialBookTransactionsToCreateMap.get(`mtm_${oldId}`);
            if (connectedMtmTx) {
                connectedMtmTx.addRemoteId(`mtm_${newId}`);
            }
            // MTM Hist
            const connectedHistMtmTx = this.financialBookTransactionsToCreateMap.get(`mtm_hist_${oldId}`);
            if (connectedHistMtmTx) {
                connectedHistMtmTx.addRemoteId(`mtm_hist_${newId}`);
            }

        }

        // Fire other batch operations
        this.fireBatchUpdateStockBookTransactions();
        this.fireBatchCreateFinancialBookTransactions();
        this.fireBatchCreateBaseBookTransactions();

    }

    // Stock book: create
    private fireBatchCreateStockBookTransactions(): Bkper.Transaction[] {
        const stockBookTransactionsToCreate = Array.from(this.stockBookTransactionsToCreate.values());
        if (stockBookTransactionsToCreate.length > 0) {
            return this.stockBook.batchCreateTransactions(stockBookTransactionsToCreate);
        }
        return [];
    }

    // Stock book: update
    private fireBatchUpdateStockBookTransactions(): void {
        const stockBookTransactionsToUpdate = Array.from(this.stockBookTransactionsToUpdateMap.values());
        if (stockBookTransactionsToUpdate.length > 0) {
            this.stockBook.batchUpdateTransactions(stockBookTransactionsToUpdate, true);
        }
    }

    // Financial book: create
    private fireBatchCreateFinancialBookTransactions(): void {
        const financialBookTransactionsToCreate = Array.from(this.financialBookTransactionsToCreateMap.values());
        if (financialBookTransactionsToCreate.length > 0) {
            this.financialBook.batchCreateTransactions(financialBookTransactionsToCreate);
        }
    }

    // Base book: create
    private fireBatchCreateBaseBookTransactions(): void {
        const baseBookTransactionsToCreate = Array.from(this.baseBookTransactionsToCreateMap.values());
        if (baseBookTransactionsToCreate.length > 0) {
            this.baseBook.batchCreateTransactions(baseBookTransactionsToCreate);
        }
    }

}
