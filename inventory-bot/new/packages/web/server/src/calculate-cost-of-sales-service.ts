import { Account, AccountType, Amount, Book, Transaction } from 'bkper-js';
import {
	ADD_COSTS_PROP,
	ADDITIONAL_COSTS_CREDITS_QUERY_RANGE,
	COGS_ACCOUNT,
	CREDIT_NOTE_PROP,
	EXC_CODE_PROP,
	LIQUIDATION_LOG_PROP,
	ORDER_PROP,
	ORIGINAL_QUANTITY_PROP,
	PARENT_ID,
	PURCHASE_CODE_PROP,
	PURCHASE_INVOICE_PROP,
	PURCHASE_LOG_PROP,
	QUANTITY_SOLD_PROP,
	SALE_INVOICE_PROP,
	TOTAL_COST_PROP,
} from '@inventory-bot-cloudflare/shared';
import type { LiquidationLogEntry, PurchaseLogEntry } from '@inventory-bot-cloudflare/shared';
import { formatDateISO, getAccountQuery, getTimeRange, parseDate } from '@inventory-bot-cloudflare/shared';
import { GoodAccount } from './good-account.js';
import { Summary } from './summary.js';
import { CalculateCostOfSalesProcessor } from './calculate-cost-of-sales-processor.js';
import {
	compareToFIFO,
	getAllTransactions,
	getBeforeDateIsoString,
	getExchangeCode,
	getFinancialBook,
	isCreditNote,
	isPurchase,
	isSale,
} from './bot-service.js';

// Entry point: calculates COGS for a single good account using the FIFO method
export async function calculateCostOfSalesForAccount(
	inventoryBook: Book,
	goodAccountId: string,
	toDate?: string,
): Promise<Summary> {
	// Pre-cache accounts in both books for faster repeated lookups
	await inventoryBook.getAccounts();

	if (!toDate) {
		toDate = inventoryBook.formatDate(new Date());
	}

	const goodAccount = new GoodAccount((await inventoryBook.getAccount(goodAccountId))!);
	const summary = new Summary(goodAccountId);

	// If the account has a pending rebuild flag, reset it first and report back
	if (goodAccount.needsRebuild()) {
		const { resetCostOfSalesForAccount } = await import('./reset-cost-of-sales-service.js');
		await resetCostOfSalesForAccount(inventoryBook, goodAccountId);
		return summary.rebuild();
	}

	const goodExcCode = await getExchangeCode(goodAccount.getAccount());
	const financialBook = getFinancialBook(inventoryBook, goodExcCode);

	if (financialBook == null) {
		return summary.setResult(`Cannot proceed: financial book not found for good account ${goodAccount.getName()}`);
	}

	// Pre-cache financial book accounts
	await financialBook.getAccounts();

	// Fetch all unchecked transactions for this account up to toDate
	const beforeDate = getBeforeDateIsoString(inventoryBook, toDate);
	const allTxs = await getAllTransactions(inventoryBook, getAccountQuery(goodAccount.getName()!, beforeDate));

	let goodAccountSaleTransactions: Transaction[] = [];
	let goodAccountPurchaseTransactionsMap = new Map<string, Transaction>();
	let goodAccountCreditNoteTransactionsMap = new Map<string, Transaction>();

	let totalSalesQuantity = 0;
	let totalPurchasedQuantity = 0;

	// Classify each unchecked transaction as sale, purchase, or credit note
	for (const tx of allTxs) {
		if (tx.isChecked()) continue;
		if (await isSale(tx)) {
			goodAccountSaleTransactions.push(tx);
			totalSalesQuantity += tx.getAmount()!.toNumber();
		}
		if (await isPurchase(tx)) {
			goodAccountPurchaseTransactionsMap.set(tx.getProperty(PURCHASE_CODE_PROP)!, tx);
			totalPurchasedQuantity += tx.getAmount()!.toNumber();
		}
		if (await isCreditNote(tx)) {
			goodAccountCreditNoteTransactionsMap.set(tx.getProperty(CREDIT_NOTE_PROP)!, tx);
			totalPurchasedQuantity -= tx.getAmount()!.toNumber();
		}
	}

	if (totalSalesQuantity === 0) return summary;

	// Sales quantity cannot exceed available inventory
	if (totalSalesQuantity > totalPurchasedQuantity) return summary.salequantityError();

	const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);

	// Process credit notes before sales to correctly adjust purchase quantities
	for (const [creditNote, creditNoteTx] of goodAccountCreditNoteTransactionsMap.entries()) {
		const purchaseCode = creditNoteTx.getProperty(PURCHASE_CODE_PROP)!;
		const purchaseTransaction = goodAccountPurchaseTransactionsMap.get(purchaseCode);
		if (purchaseTransaction) {
			const creditNoteQuantity = new Amount(creditNoteTx.getAmount()!.toNumber());
			const remainingQuantity = purchaseTransaction.getAmount()!.minus(creditNoteQuantity);

			if (remainingQuantity.toNumber() <= 0) {
				return summary.creditNoteQuantityError(creditNoteTx.getProperty(CREDIT_NOTE_PROP)!);
			}

			// Split the purchase transaction to isolate the credit-noted portion
			const purchaseCreditAccount = await purchaseTransaction.getCreditAccount();
			const purchaseDebitAccount = await purchaseTransaction.getDebitAccount();
			const splittedPurchaseTransaction = new Transaction(inventoryBook)
				.setDate(purchaseTransaction.getDate()!)
				.setAmount(creditNoteQuantity)
				.setCreditAccount(purchaseCreditAccount)
				.setDebitAccount(purchaseDebitAccount)
				.setDescription(purchaseTransaction.getDescription()!)
				.setProperty(PARENT_ID, purchaseTransaction.getId()!)
				.setProperty(PURCHASE_CODE_PROP, purchaseCode)
				.setProperty(CREDIT_NOTE_PROP, creditNote)
				.addRemoteId(creditNote)
				.setChecked(true);

			processor.setInventoryBookTransactionToCreate(splittedPurchaseTransaction);

			// Reduce the original purchase by the credit note quantity
			purchaseTransaction.setAmount(remainingQuantity);
			processor.setInventoryBookTransactionToUpdate(purchaseTransaction);
			goodAccountPurchaseTransactionsMap.set(purchaseCode, purchaseTransaction);

			// Mark credit note as processed
			creditNoteTx.setChecked(true);
			processor.setInventoryBookTransactionToUpdate(creditNoteTx);
		}
	}

	// Sort both lists into FIFO order before matching
	goodAccountSaleTransactions = goodAccountSaleTransactions.sort(compareToFIFO);
	const goodAccountPurchaseTransactions = Array.from(goodAccountPurchaseTransactionsMap.values()).sort(compareToFIFO);

	// Match each sale against purchase batches in FIFO order
	for (const saleTransaction of goodAccountSaleTransactions) {
		await processSale(financialBook, inventoryBook, saleTransaction, goodAccountPurchaseTransactions, processor);
		if (processor.hasLockedTransaction()) return summary.lockError();
	}

	// Execute all batched writes
	await processor.fireBatchOperations();

	storeLastCalcTxDate(goodAccount, goodAccountSaleTransactions);

	return summary.calculatingAsync();
}

// Updates the account's COGS calculation date to the last processed sale date
function storeLastCalcTxDate(goodAccount: GoodAccount, goodAccountSaleTransactions: Transaction[]): void {
	const lastSaleTx = goodAccountSaleTransactions.length > 0
		? goodAccountSaleTransactions[goodAccountSaleTransactions.length - 1]
		: null;

	const lastTxDateValue = lastSaleTx?.getDateValue() ?? null;
	const lastTxDate = lastSaleTx?.getDate() ?? null;

	const goodAccountLastTxDateValue = goodAccount.getCOGSCalculationDateValue();
	if (lastTxDateValue != null && (goodAccountLastTxDateValue == null || lastTxDateValue > goodAccountLastTxDateValue)) {
		goodAccount.setCOGSCalculationDate(lastTxDate ?? '');
		// Fire-and-forget: update is async but we don't need to await it here
		goodAccount.update().catch(console.error);
	}
}

// Matches a single sale transaction against purchase batches in FIFO order, computing COGS
async function processSale(
	financialBook: Book,
	inventoryBook: Book,
	saleTransaction: Transaction,
	purchaseTransactions: Transaction[],
	processor: CalculateCostOfSalesProcessor,
): Promise<void> {
	console.log(`processing sale: ${saleTransaction.getId()} - ${saleTransaction.getDescription()}`);

	let soldQuantity = saleTransaction.getAmount()!;
	let saleCost = new Amount(0);
	const purchaseLogEntries: PurchaseLogEntry[] = [];

	for (const purchaseTransaction of purchaseTransactions) {
		if (purchaseTransaction.isChecked()) continue;

		console.log(`processing purchase: ${purchaseTransaction.getId()} - ${purchaseTransaction.getDescription()}`);

		const purchaseCode = purchaseTransaction.getProperty(PURCHASE_CODE_PROP)!;
		const originalQuantity = new Amount(purchaseTransaction.getProperty(ORIGINAL_QUANTITY_PROP)!);
		const transactionQuantity = purchaseTransaction.getAmount()!;
		const transactionCost = new Amount(purchaseTransaction.getProperty(TOTAL_COST_PROP)!);

		const creditNotesQuantity = originalQuantity.minus(transactionQuantity).toNumber();
		let additionalCosts = new Amount(0);
		let creditNotesAmount = new Amount(0);

		// Fetch additional costs and credit notes only for unprocessed purchases
		if (
			purchaseTransaction.getProperty(CREDIT_NOTE_PROP) === undefined &&
			purchaseTransaction.getProperty(ADD_COSTS_PROP) === undefined
		) {
			({ additionalCosts, creditNotesAmount } = await getAdditionalCostsAndCreditNotes(financialBook, purchaseTransaction));
		}

		const updatedCost = transactionCost.plus(additionalCosts).minus(creditNotesAmount);
		const costOfSalePerUnit = updatedCost.div(transactionQuantity);

		if (soldQuantity.gte(transactionQuantity)) {
			// Entire purchase batch is consumed by this sale
			saleCost = saleCost.plus(updatedCost);

			const liquidationLog = getLiquidationLog(saleTransaction, costOfSalePerUnit);
			purchaseTransaction
				.setProperty(TOTAL_COST_PROP, updatedCost.toString())
				.setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(liquidationLog))
				.setProperty(ADD_COSTS_PROP, additionalCosts.toString())
				.setProperty(CREDIT_NOTE_PROP, JSON.stringify({ quantity: creditNotesQuantity, amount: creditNotesAmount.toNumber() }))
				.setChecked(true);

			processor.setInventoryBookTransactionToUpdate(purchaseTransaction);
			purchaseLogEntries.push(getPurchaseLog(transactionQuantity, costOfSalePerUnit, purchaseTransaction));
			soldQuantity = soldQuantity.minus(transactionQuantity);

		} else {
			// Purchase batch is partially consumed: split the remaining quantity
			const remainingQuantity = transactionQuantity.minus(soldQuantity);
			const partialBuyQuantity = transactionQuantity.minus(remainingQuantity);
			const splittedCost = partialBuyQuantity.times(costOfSalePerUnit);
			const remainingCost = updatedCost.minus(splittedCost);

			saleCost = saleCost.plus(splittedCost);

			purchaseTransaction
				.setAmount(remainingQuantity)
				.setProperty(TOTAL_COST_PROP, remainingCost.toString())
				.setProperty(ADD_COSTS_PROP, additionalCosts.toString())
				.setProperty(CREDIT_NOTE_PROP, JSON.stringify({ quantity: creditNotesQuantity, amount: creditNotesAmount.toNumber() }));

			processor.setInventoryBookTransactionToUpdate(purchaseTransaction);

			// Create a new transaction representing the consumed portion
			const liquidationLog = getLiquidationLog(saleTransaction, costOfSalePerUnit);
			const purchaseCreditAccount = await purchaseTransaction.getCreditAccount();
			const purchaseDebitAccount = await purchaseTransaction.getDebitAccount();
			const splittedPurchaseTransaction = new Transaction(inventoryBook)
				.setDate(purchaseTransaction.getDate()!)
				.setAmount(partialBuyQuantity)
				.setCreditAccount(purchaseCreditAccount)
				.setDebitAccount(purchaseDebitAccount)
				.setDescription(purchaseTransaction.getDescription()!)
				.setProperty(EXC_CODE_PROP, purchaseTransaction.getProperty(EXC_CODE_PROP)!)
				.setProperty(PARENT_ID, purchaseTransaction.getId()!)
				.setProperty(PURCHASE_CODE_PROP, purchaseCode)
				.setProperty(TOTAL_COST_PROP, splittedCost.toString())
				.setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(liquidationLog))
				.setProperty(ORDER_PROP, purchaseTransaction.getProperty(ORDER_PROP)!)
				.addRemoteId(processor.generateId())
				.setChecked(true);

			processor.setInventoryBookTransactionToCreate(splittedPurchaseTransaction);
			purchaseLogEntries.push(getPurchaseLog(partialBuyQuantity, costOfSalePerUnit, purchaseTransaction));
			soldQuantity = soldQuantity.minus(partialBuyQuantity);
		}

		// Stop iterating once the sale is fully matched
		if (soldQuantity.eq(0)) break;
	}

	// Mark the sale as checked and store the purchase log
	if (soldQuantity.round(inventoryBook.getFractionDigits()!).eq(0)) {
		if (purchaseLogEntries.length > 0) {
			saleTransaction
				.setProperty(TOTAL_COST_PROP, saleCost.toString())
				.setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries))
				.setChecked(true);
		}
		processor.setInventoryBookTransactionToUpdate(saleTransaction);
	}

	// Post the COGS entry in the financial book
	await addCostOfSales(financialBook, saleTransaction, saleCost, processor);
}

// Creates a COGS transaction in the financial book linked to the inventory sale
async function addCostOfSales(
	financialBook: Book,
	saleTransaction: Transaction,
	saleCost: Amount,
	processor: CalculateCostOfSalesProcessor,
): Promise<void> {
	// Find or create the COGS account in the financial book
	let costOfSalesAccount = await financialBook.getAccount(COGS_ACCOUNT);
	if (!costOfSalesAccount) {
		costOfSalesAccount = await new Account(financialBook)
			.setName(COGS_ACCOUNT)
			.setType(AccountType.OUTGOING)
			.create();
	}

	const creditAccountName = await saleTransaction.getCreditAccountName();
	const financialGoodAccount = await financialBook.getAccount(creditAccountName!);
	const remoteId = saleTransaction.getId()!;
	const description = `#COGS ${saleTransaction.getDescription()}`;

	// Link the COGS transaction to the originating sale via remoteId
	const costOfSaleTransaction = new Transaction(financialBook)
		.addRemoteId(remoteId)
		.setDate(saleTransaction.getDate()!)
		.setAmount(saleCost)
		.setDescription(description)
		.from(financialGoodAccount)
		.to(costOfSalesAccount)
		.setProperty(QUANTITY_SOLD_PROP, `${saleTransaction.getAmount()!.toNumber()}`)
		.setProperty(SALE_INVOICE_PROP, `${saleTransaction.getProperty(SALE_INVOICE_PROP)}`)
		.setChecked(true);

	processor.setFinancialBookTransactionToCreate(costOfSaleTransaction);
}

// Searches for additional costs and credit notes linked to a purchase within a date window
export async function getAdditionalCostsAndCreditNotes(
	financialBook: Book,
	inventoryTransaction: Transaction,
): Promise<{ additionalCosts: Amount; creditNotesAmount: Amount }> {
	// Build a date window around the purchase transaction date
	const transactionDate = parseDate(inventoryTransaction.getDate()!);
	const timeRange = getTimeRange(ADDITIONAL_COSTS_CREDITS_QUERY_RANGE);

	const beforeDate = new Date(transactionDate.getTime() + timeRange);
	const afterDate = new Date(transactionDate.getTime() - timeRange);
	const beforeDateIso = formatDateISO(beforeDate, financialBook.getTimeZone()!);
	const afterDateIso = formatDateISO(afterDate, financialBook.getTimeZone()!);

	// Resolve the inventory account's counterpart in the financial book
	const debitAccount = await inventoryTransaction.getDebitAccount();
	const inventoryAccountName = debitAccount?.getName()!;
	const query = getAccountQuery(inventoryAccountName, beforeDateIso, afterDateIso);

	const purchaseCode = inventoryTransaction.getProperty(PURCHASE_CODE_PROP)!;
	const transactions = await getAllTransactions(financialBook, query);
	const financialAccount = await financialBook.getAccount(inventoryAccountName);
	const financialAccountId = financialAccount?.getId();

	let totalAdditionalCosts = new Amount(0);
	let totalCreditAmount = new Amount(0);

	// Tally additional costs and credit notes linked to this purchase code
	for (const tx of transactions) {
		const txDebitAccount = await tx.getDebitAccount();
		const txCreditAccount = await tx.getCreditAccount();

		// Additional cost: checked, debits the good account, same purchase code, different invoice
		if (
			tx.isChecked() &&
			txDebitAccount?.getId() === financialAccountId &&
			tx.getProperty(PURCHASE_CODE_PROP) === purchaseCode &&
			tx.getProperty(PURCHASE_INVOICE_PROP) !== undefined &&
			tx.getProperty(PURCHASE_INVOICE_PROP) !== purchaseCode
		) {
			totalAdditionalCosts = totalAdditionalCosts.plus(tx.getAmount()!);
		}
		// Credit note: checked, has credit_note property, same purchase code, credits the good account
		else if (
			tx.isChecked() &&
			tx.getProperty(CREDIT_NOTE_PROP) !== undefined &&
			tx.getProperty(PURCHASE_CODE_PROP) === purchaseCode &&
			txCreditAccount?.getId() === financialAccountId
		) {
			totalCreditAmount = totalCreditAmount.plus(tx.getAmount()!);
		}
	}

	return { additionalCosts: totalAdditionalCosts, creditNotesAmount: totalCreditAmount };
}

// Builds a liquidation log entry from a sale transaction
function getLiquidationLog(transaction: Transaction, costOfSalePerUnit: Amount): LiquidationLogEntry {
	return {
		id: transaction.getId()!,
		dt: transaction.getDate()!,
		qt: transaction.getAmount()!.toString(),
		uc: costOfSalePerUnit.toString(),
		rt: '',
	};
}

// Builds a purchase log entry for a consumed quantity
function getPurchaseLog(quantity: Amount, costOfSalePerUnit: Amount, transaction: Transaction): PurchaseLogEntry {
	return {
		id: transaction.getId()!,
		qt: quantity.toString(),
		uc: costOfSalePerUnit.toString(),
		rt: '',
	};
}
