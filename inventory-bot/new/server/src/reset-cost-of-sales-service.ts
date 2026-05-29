import { Amount, Book } from 'bkper-js';
import {
	ADD_COSTS_PROP,
	APP_NAME,
	CREDIT_NOTE_PROP,
	GOOD_PURCHASE_COST_PROP,
	LIQUIDATION_LOG_PROP,
	ORIGINAL_QUANTITY_PROP,
	PARENT_ID,
	PURCHASE_LOG_PROP,
	TOTAL_COST_PROP,
} from './shared/constants.js';
import { GoodAccount } from './good-account.js';
import { Summary } from './summary.js';
import { ResetCostOfSalesProcessor } from './reset-cost-of-sales-processor.js';
import { getAllTransactions, getExchangeCode, getFinancialBook } from './bot-service.js';
import { getAccountQuery } from './shared/utils.js';

// Entry point: resets all COGS data for a single good account, reversing any prior calculation
export async function resetCostOfSalesForAccount(
	inventoryBook: Book,
	goodAccountId: string,
): Promise<Summary> {
	const summary = new Summary(goodAccountId);

	// Pre-cache accounts for faster lookups
	await inventoryBook.getAccounts();

	const goodAccount = new GoodAccount((await inventoryBook.getAccount(goodAccountId))!);
	const goodExcCode = await getExchangeCode(goodAccount.getAccount());
	const financialBook = getFinancialBook(inventoryBook, goodExcCode);

	if (financialBook == null) return summary;

	await financialBook.getAccounts();

	// Fetch all transactions for this account (no date filter — full reset)
	const transactions = await getAllTransactions(inventoryBook, getAccountQuery(goodAccount.getName()!));

	const processor = new ResetCostOfSalesProcessor(inventoryBook, financialBook);

	for (const tx of transactions) {
		console.log(`processing transaction: ${tx.getId()}`);

		// Uncheck before resetting
		if (tx.isChecked()) {
			tx.setChecked(false);
		}

		// Only process transactions created by this bot
		if (tx.getAgentId() !== APP_NAME) continue;

		if (tx.getProperty(PURCHASE_LOG_PROP)) {
			// Sale transaction: trash the linked COGS entry in the financial book
			const cogsTxs = await getAllTransactions(financialBook, `remoteId:${tx.getId()}`);
			if (cogsTxs.length > 0) {
				const cogsTx = cogsTxs[0];
				if (cogsTx.isChecked()) cogsTx.setChecked(false);
				processor.setFinancialBookTransactionToTrash(cogsTx);
			}

			// Remove liquidation properties from the sale transaction
			tx.deleteProperty(PURCHASE_LOG_PROP).deleteProperty(TOTAL_COST_PROP);
			processor.setInventoryBookTransactionToUpdate(tx);
			continue;
		}

		// Purchase split transaction: trash it entirely
		if (tx.getProperty(PARENT_ID)) {
			processor.setInventoryBookTransactionToTrash(tx);
		}

		// Original purchase transaction: restore quantity and cost
		if (tx.getProperty(ORIGINAL_QUANTITY_PROP)) {
			const goodPurchaseCost = new Amount(tx.getProperty(GOOD_PURCHASE_COST_PROP)!);
			const originalQuantity = new Amount(tx.getProperty(ORIGINAL_QUANTITY_PROP)!);

			tx.setAmount(originalQuantity);
			tx.setProperty(TOTAL_COST_PROP, goodPurchaseCost.toString());

			// Clear all liquidation and credit note metadata
			tx.deleteProperty(LIQUIDATION_LOG_PROP);
			tx.deleteProperty(ADD_COSTS_PROP);
			tx.deleteProperty(CREDIT_NOTE_PROP);

			processor.setInventoryBookTransactionToUpdate(tx);
		}

		// Credit note transaction: update only (already unchecked above)
		if (tx.getProperty(CREDIT_NOTE_PROP)) {
			processor.setInventoryBookTransactionToUpdate(tx);
		}
	}

	if (processor.hasLockedTransaction()) return summary.lockError();

	// Execute all batched writes
	await processor.fireBatchOperations();

	// Clear the rebuild flag and COGS date on the account
	goodAccount.clearNeedsRebuild();
	goodAccount.setCOGSCalculationDate('');
	await goodAccount.update();

	return summary.resetingAsync();
}
