import { Book, Transaction } from 'bkper-js';

// Batches all inventory and financial book write operations for a COGS calculation run
export class CalculateCostOfSalesProcessor {

	private inventoryBook: Book;
	private financialBook: Book;

	// Deduplication maps keyed by remoteId (creates) or transaction id (updates)
	private inventoryBookTransactionsToCreateMap = new Map<string, Transaction>();
	private inventoryBookTransactionsToUpdateMap = new Map<string, Transaction>();
	private financialBookTransactionsToCreateMap = new Map<string, Transaction>();

	private isAnyTransactionLocked = false;

	constructor(inventoryBook: Book, financialBook: Book) {
		this.inventoryBook = inventoryBook;
		this.financialBook = financialBook;
	}

	// Extracts the first remoteId from a not-yet-created transaction as its dedup key
	private getRemoteId(transaction: Transaction): string {
		const remoteIds = transaction.getRemoteIds();
		return remoteIds?.length > 0 ? remoteIds[0] : '';
	}

	// Generates a unique id using the Web Crypto API available in Cloudflare Workers
	generateId(): string {
		return crypto.randomUUID();
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
		this.inventoryBookTransactionsToCreateMap.set(this.getRemoteId(transaction), transaction);
	}

	setInventoryBookTransactionToUpdate(transaction: Transaction): void {
		this.checkTransactionLocked(transaction);
		this.inventoryBookTransactionsToUpdateMap.set(transaction.getId()!, transaction);
	}

	setFinancialBookTransactionToCreate(transaction: Transaction): void {
		this.checkTransactionLocked(transaction);
		this.financialBookTransactionsToCreateMap.set(this.getRemoteId(transaction), transaction);
	}

	// Fires all batched operations in dependency order: create → update → create financial
	async fireBatchOperations(): Promise<void> {
		await this.fireBatchCreateInventoryBookTransactions();
		await this.fireBatchUpdateInventoryBookTransactions();
		await this.fireBatchCreateFinancialBookTransactions();
	}

	// Inventory book: batch create
	private async fireBatchCreateInventoryBookTransactions(): Promise<Transaction[]> {
		const toCreate = Array.from(this.inventoryBookTransactionsToCreateMap.values());
		if (toCreate.length > 0) {
			return this.inventoryBook.batchCreateTransactions(toCreate);
		}
		return [];
	}

	// Inventory book: batch update
	private async fireBatchUpdateInventoryBookTransactions(): Promise<void> {
		const toUpdate = Array.from(this.inventoryBookTransactionsToUpdateMap.values());
		if (toUpdate.length > 0) {
			await this.inventoryBook.batchUpdateTransactions(toUpdate, true);
		}
	}

	// Financial book: batch create
	private async fireBatchCreateFinancialBookTransactions(): Promise<Transaction[]> {
		const toCreate = Array.from(this.financialBookTransactionsToCreateMap.values());
		if (toCreate.length > 0) {
			return this.financialBook.batchCreateTransactions(toCreate);
		}
		return [];
	}

}
