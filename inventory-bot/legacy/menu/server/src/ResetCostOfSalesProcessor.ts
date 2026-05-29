class ResetCostOfSalesProcessor {

    private inventoryBook: Bkper.Book;
    private financialBook: Bkper.Book;

    private financialBookTransactionsToTrashMap = new Map<string, Bkper.Transaction>();
    private inventoryBookTransactionsToUpdateMap = new Map<string, Bkper.Transaction>();
    private inventoryBookTransactionsToTrashMap = new Map<string, Bkper.Transaction>();

    private isAnyTransactionLocked = false;


    constructor(inventoryBook: Bkper.Book, financialBook: Bkper.Book) {
        this.inventoryBook = inventoryBook;
        this.financialBook = financialBook;
    }


    setFinancialBookTransactionToTrash(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.financialBookTransactionsToTrashMap.set(transaction.getId(), transaction);
    }

    setInventoryBookTransactionToUpdate(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.inventoryBookTransactionsToUpdateMap.set(transaction.getId(), transaction);
    }

    setInventoryBookTransactionToTrash(transaction: Bkper.Transaction): void {
        this.checkTransactionLocked(transaction);
        this.inventoryBookTransactionsToTrashMap.set(transaction.getId(), transaction);
    }

    private checkTransactionLocked(transaction: Bkper.Transaction): void {
        if (transaction.isLocked()) {
            this.isAnyTransactionLocked = true;
        }
    }

    hasLockedTransaction(): boolean {
        return this.isAnyTransactionLocked;
    }

    fireBatchOperations(): void {
        this.fireBatchTrashFinancialBookTransactions();
        this.fireBatchUpdateInventoryBookTransactions();
        this.fireBatchTrashInventoryBookTransactions();
    }

    // Financial book: trash
    private fireBatchTrashFinancialBookTransactions(): void {
        const financialBookTransactionsToTrash = Array.from(this.financialBookTransactionsToTrashMap.values());
        if (financialBookTransactionsToTrash.length > 0) {
            this.financialBook.batchTrashTransactions(financialBookTransactionsToTrash, true);
        }
    }

    // Inventory book: update
    private fireBatchUpdateInventoryBookTransactions(): void {
        const inventoryBookTransactionsToUpdate = Array.from(this.inventoryBookTransactionsToUpdateMap.values());
        if (inventoryBookTransactionsToUpdate.length > 0) {
            this.inventoryBook.batchUpdateTransactions(inventoryBookTransactionsToUpdate, true);
        }
    }

    // Inventory book: trash
    private fireBatchTrashInventoryBookTransactions(): void {
        const inventoryBookTransactionsToTrash = Array.from(this.inventoryBookTransactionsToTrashMap.values());
        if (inventoryBookTransactionsToTrash.length > 0) {
            this.inventoryBook.batchTrashTransactions(inventoryBookTransactionsToTrash, true);
        }
    }

}