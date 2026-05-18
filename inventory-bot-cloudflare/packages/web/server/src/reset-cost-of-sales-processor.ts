import { Book, Transaction } from 'bkper-js';

// Batches all inventory and financial book write operations for a COGS reset run
export class ResetCostOfSalesProcessor {

	private inventoryBook: Book;
	private financialBook: Book;

	private financialBookTransactionsToTrashMap = new Map<string, Transaction>();
	private inventoryBookTransactionsToUpdateMap = new Map<string, Transaction>();
	private inventoryBookTransactionsToTrashMap = new Map<string, Transaction>();

	private isAnyTransactionLocked = false;

	constructor(inventoryBook: Book, financialBook: Book) {
		this.inventoryBook = inventoryBook;
		this.financialBook = financialBook;
	}

	setFinancialBookTransactionToTrash(transaction: Transaction): void {
		this.checkTransactionLocked(transaction);
		this.financialBookTransactionsToTrashMap.set(transaction.getId()!, transaction);
	}

	setInventoryBookTransactionToUpdate(transaction: Transaction): void {
		this.checkTransactionLocked(transaction);
		this.inventoryBookTransactionsToUpdateMap.set(transaction.getId()!, transaction);
	}

	setInventoryBookTransactionToTrash(transaction: Transaction): void {
		this.checkTransactionLocked(transaction);
		this.inventoryBookTransactionsToTrashMap.set(transaction.getId()!, transaction);
	}

	private checkTransactionLocked(transaction: Transaction): void {
		if (transaction.isLocked()) {
			this.isAnyTransactionLocked = true;
		}
	}

	hasLockedTransaction(): boolean {
		return this.isAnyTransactionLocked;
	}

	// Fires all batched operations in dependency order: trash financial → update inventory → trash inventory
	async fireBatchOperations(): Promise<void> {
		await this.fireBatchTrashFinancialBookTransactions();
		await this.fireBatchUpdateInventoryBookTransactions();
		await this.fireBatchTrashInventoryBookTransactions();
	}

	// Financial book: batch trash
	private async fireBatchTrashFinancialBookTransactions(): Promise<void> {
		const toTrash = Array.from(this.financialBookTransactionsToTrashMap.values());
		if (toTrash.length > 0) {
			await this.financialBook.batchTrashTransactions(toTrash, true);
		}
	}

	// Inventory book: batch update
	private async fireBatchUpdateInventoryBookTransactions(): Promise<void> {
		const toUpdate = Array.from(this.inventoryBookTransactionsToUpdateMap.values());
		if (toUpdate.length > 0) {
			await this.inventoryBook.batchUpdateTransactions(toUpdate, true);
		}
	}

	// Inventory book: batch trash
	private async fireBatchTrashInventoryBookTransactions(): Promise<void> {
		const toTrash = Array.from(this.inventoryBookTransactionsToTrashMap.values());
		if (toTrash.length > 0) {
			await this.inventoryBook.batchTrashTransactions(toTrash, true);
		}
	}

}
