import { Account, AccountType, Book, Transaction } from 'bkper-js';
import {
	CREDIT_NOTE_PROP,
	EXC_CODE_PROP,
	INVENTORY_BOOK_PROP,
	ORDER_PROP,
} from './shared/constants.js';
import { formatDateISO } from './shared/utils.js';

// Finds the inventory book in the collection — identified by the inventory_book property or fraction digits = 0
export function getInventoryBook(book: Book): Book | null {
	const collection = book.getCollection();
	if (collection == null) return null;
	for (const connectedBook of collection.getBooks()) {
		if (connectedBook.getProperty(INVENTORY_BOOK_PROP)) return connectedBook;
		if (connectedBook.getFractionDigits() === 0) return connectedBook;
	}
	return null;
}

// Finds the financial book for a given exchange code in the collection
export function getFinancialBook(book: Book, excCode: string | null): Book | null {
	if (book.getCollection() == null || excCode == null) return null;
	for (const connectedBook of book.getCollection()!.getBooks()) {
		const fractionDigits = connectedBook.getFractionDigits();
		if (fractionDigits !== 0 && excCode === getExcCode(connectedBook)) {
			return connectedBook;
		}
	}
	return null;
}

// Reads the exchange code property from a book, falling back to the legacy key
export function getExcCode(book: Book): string | undefined {
	return book.getProperty(EXC_CODE_PROP, 'exchange_code');
}

// Reads exchange code from an account's parent groups
export async function getExchangeCode(account: Account): Promise<string | null> {
	const type = account.getType();
	if (type === AccountType.INCOMING || type === AccountType.OUTGOING) return null;
	const groups = await account.getGroups();
	for (const group of groups ?? []) {
		if (group == null) continue;
		const exchange = group.getProperty(EXC_CODE_PROP);
		if (exchange != null && exchange.trim() !== '') return exchange;
	}
	return null;
}

// Checks whether the book's backlog has any pending tasks
export async function hasPendingTasks(book: Book): Promise<boolean> {
	const backlog = await book.getBacklog();
	return (backlog.getCount() ?? 0) > 0;
}

// Returns true if the transaction is a sale (debit account is Outgoing)
export async function isSale(tx: Transaction): Promise<boolean> {
	if (!tx.isPosted()) return false;
	const debitAccount = await tx.getDebitAccount();
	return debitAccount?.getType() === AccountType.OUTGOING;
}

// Returns true if the transaction is a purchase (credit account is Incoming)
export async function isPurchase(tx: Transaction): Promise<boolean> {
	if (!tx.isPosted()) return false;
	const creditAccount = await tx.getCreditAccount();
	return creditAccount?.getType() === AccountType.INCOMING;
}

// Returns true if the transaction is a credit note (debit account is Incoming + credit_note property set)
export async function isCreditNote(tx: Transaction): Promise<boolean> {
	if (!tx.isPosted()) return false;
	const debitAccount = await tx.getDebitAccount();
	return debitAccount?.getType() === AccountType.INCOMING && tx.getProperty(CREDIT_NOTE_PROP) !== undefined;
}

// Compares two transactions for FIFO ordering: date → order property → creation time
export function compareToFIFO(tx1: Transaction, tx2: Transaction): number {
	let ret = (tx1.getDateValue() ?? 0) - (tx2.getDateValue() ?? 0);

	if (ret === 0) {
		const order1 = tx1.getProperty(ORDER_PROP) ? +tx1.getProperty(ORDER_PROP)! : 0;
		const order2 = tx2.getProperty(ORDER_PROP) ? +tx2.getProperty(ORDER_PROP)! : 0;
		ret = order1 - order2;
	}

	if (ret === 0 && tx1.getCreatedAt() && tx2.getCreatedAt()) {
		ret = tx1.getCreatedAt()!.getMilliseconds() - tx2.getCreatedAt()!.getMilliseconds();
	}

	return ret;
}

// Returns the ISO date string of the day after toDateIsoString, in the book's timezone
export function getBeforeDateIsoString(book: Book, toDateIsoString: string): string {
	const toDate = book.parseDate(toDateIsoString);
	const beforeDate = new Date(toDate.getTime());
	beforeDate.setDate(beforeDate.getDate() + 1);
	return formatDateISO(beforeDate, book.getTimeZone()!);
}

// Collects all transactions matching a query, paginating through all cursor pages
export async function getAllTransactions(book: Book, query: string): Promise<Transaction[]> {
	const transactions: Transaction[] = [];
	let cursor: string | undefined;
	do {
		const list = await book.listTransactions(query, 500, cursor);
		transactions.push(...list.getItems());
		cursor = list.getCursor();
	} while (cursor);
	return transactions;
}
