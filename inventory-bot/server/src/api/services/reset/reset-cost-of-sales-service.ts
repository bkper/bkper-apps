import { Amount, type Book, type Transaction } from 'bkper-js';
import {
    CREDIT_NOTE_PROP,
    GOOD_PURCHASE_COST_PROP,
    LIQUIDATION_LOG_PROP,
    ORIGINAL_QUANTITY_PROP,
    PARENT_ID_PROP as PARENT_ID,
    PURCHASE_LOG_PROP,
    TOTAL_ADDITIONAL_COSTS_PROP as ADD_COSTS_PROP,
    TOTAL_COST_PROP,
} from '../../../shared/constants.js';
import { GoodAccount } from '../good-account.js';
import { getAccountQuery } from '../helper.js';
import type { OperationContext } from '../operation-service.js';
import { Summary } from '../summary.js';
import { ResetCostOfSalesProcessor } from './reset-cost-of-sales-processor.js';

export class ResetCostOfSalesService {
    async execute(context: OperationContext): Promise<Summary> {
        const inventoryBook = context.inventoryBook;
        const financialBook = context.financialBook;
        const goodAccount = new GoodAccount(context.inventoryAccount);

        const summary = new Summary(goodAccount.getId()!);

        const query = getAccountQuery(goodAccount.getName()!);
        const transactions = await this.listTransactions(inventoryBook, query);

        // Processor
        const processor = new ResetCostOfSalesProcessor(inventoryBook, financialBook);

        for (const tx of transactions) {
            // Log operation status
            console.log(`processing transaction: ${tx.getId()}`);

            if (tx.isChecked()) {
                tx.setChecked(false);
            }

            if (tx.getAgentId() == 'inventory-bot') {
                // Reset sale transactions
                if (tx.getProperty(PURCHASE_LOG_PROP)) {
                    // Trash COGs transactions connected to liquidations
                    const linkedCOGsTransactions = await this.listTransactions(
                        financialBook,
                        `remoteId:${tx.getId()}`
                    );
                    if (linkedCOGsTransactions.length > 0) {
                        const COGsTransaction = linkedCOGsTransactions[0]!;
                        if (COGsTransaction.isChecked()) {
                            COGsTransaction.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(COGsTransaction);
                    }

                    // Remove liquidation properties: purchase_log, total_cost
                    tx.deleteProperty(PURCHASE_LOG_PROP).deleteProperty(TOTAL_COST_PROP);
                    // Store transaction to be updated
                    processor.setInventoryBookTransactionToUpdate(tx);
                    continue;
                }

                // Reset purchase transactions
                if (tx.getProperty(PARENT_ID)) {
                    // Trash splitted transaction
                    processor.setInventoryBookTransactionToTrash(tx);
                }
                if (tx.getProperty(ORIGINAL_QUANTITY_PROP)) {
                    // Reset parent transaction
                    const goodPurchaseCost = new Amount(tx.getProperty(GOOD_PURCHASE_COST_PROP)!);
                    const originalQuantity = new Amount(tx.getProperty(ORIGINAL_QUANTITY_PROP)!);

                    tx.setAmount(originalQuantity);
                    tx.setProperty(TOTAL_COST_PROP, goodPurchaseCost.toString());

                    // remove liquidation log
                    tx.deleteProperty(LIQUIDATION_LOG_PROP);
                    tx.deleteProperty(ADD_COSTS_PROP);
                    tx.deleteProperty(CREDIT_NOTE_PROP);

                    // Store transaction to be updated
                    processor.setInventoryBookTransactionToUpdate(tx);
                }

                // Reset credit note transaction
                if (tx.getProperty(CREDIT_NOTE_PROP)) {
                    processor.setInventoryBookTransactionToUpdate(tx);
                }
            }
        }

        // Abort if any transaction is locked
        if (processor.hasLockedTransaction()) {
            return summary.lockError();
        }

        // Fire batch operations
        await processor.fireBatchOperations();

        // Update account
        goodAccount.clearNeedsRebuild();
        goodAccount.setCOGSCalculationDate('');
        await goodAccount.update();

        return summary.resetingAsync();
    }

    private async listTransactions(book: Book, query: string): Promise<Transaction[]> {
        const transactions: Transaction[] = [];
        let cursor: string | undefined;
        do {
            const page = await book.listTransactions(query, undefined, cursor);
            transactions.push(...page.getItems());
            cursor = page.getCursor();
        } while (cursor);
        return transactions;
    }
}
