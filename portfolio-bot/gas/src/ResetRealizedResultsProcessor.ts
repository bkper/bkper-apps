class ResetRealizedResultsProcessor {

    private stockBook: Bkper.Book;
    private financialBook: Bkper.Book;
    private baseBook: Bkper.Book;

    private stockBookTransactionsToUpdateMap = new Map<string, Bkper.Transaction>();
    private stockBookTransactionsToTrashMap = new Map<string, Bkper.Transaction>();
    private financialBookTransactionsToTrashMap = new Map<string, Bkper.Transaction>();
    private baseBookTransactionsToTrashMap = new Map<string, Bkper.Transaction>();

    private isAnyTransactionLocked = false;

    constructor(stockBook: Bkper.Book, financialBook: Bkper.Book, baseBook: Bkper.Book) {
        this.stockBook = stockBook;
        this.financialBook = financialBook;
        this.baseBook = baseBook;
    }

    private checkTransactionLocked(transaction: Bkper.Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    setStockBookTransactionToUpdate(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToUpdateMap.set(transaction.getId(), transaction);
    }

    setStockBookTransactionToTrash(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.stockBookTransactionsToTrashMap.set(transaction.getId(), transaction);
    }

    setFinancialBookTransactionToTrash(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.financialBookTransactionsToTrashMap.set(transaction.getId(), transaction);
    }

    setBaseBookTransactionToTrash(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.baseBookTransactionsToTrashMap.set(transaction.getId(), transaction);
    }

    fireBatchOperations(): void {
        this.fireBatchUpdateStockBookTransactions();
        this.fireBatchTrashStockBookTransactions();
        this.fireBatchTrashFinancialBookTransactions();
        this.fireBatchTrashBaseBookTransactions();
    }

    // Stock book: update
    private fireBatchUpdateStockBookTransactions(): void {
        const stockBookTransactionsToUpdate = Array.from(this.stockBookTransactionsToUpdateMap.values());
        if (stockBookTransactionsToUpdate.length > 0) {
            this.stockBook.batchUpdateTransactions(stockBookTransactionsToUpdate, true);
        }
    }

    // Stock book: trash
    private fireBatchTrashStockBookTransactions(): void {
        const stockBookTransactionsToTrash = Array.from(this.stockBookTransactionsToTrashMap.values());
        if (stockBookTransactionsToTrash.length > 0) {
            this.stockBook.batchTrashTransactions(stockBookTransactionsToTrash, true);
        }
    }

    // Financial book: trash
    private fireBatchTrashFinancialBookTransactions(): void {
        const financialBookTransactionsToTrash = Array.from(this.financialBookTransactionsToTrashMap.values());
        if (financialBookTransactionsToTrash.length > 0) {
            this.financialBook.batchTrashTransactions(financialBookTransactionsToTrash, true);
        }
    }

    // Base book: trash
    private fireBatchTrashBaseBookTransactions(): void {
        const baseBookTransactionsToTrash = Array.from(this.baseBookTransactionsToTrashMap.values());
        if (baseBookTransactionsToTrash.length > 0) {
            this.baseBook.batchTrashTransactions(baseBookTransactionsToTrash, true);
        }
    }

}
