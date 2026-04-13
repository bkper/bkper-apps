namespace CostOfSalesService {

    export function resetCostOfSalesForAccount(inventoryBookId: string, goodAccountId: string): Summary {
        const summary = new Summary(goodAccountId);

        const inventoryBook = BkperApp.getBook(inventoryBookId);
        const goodAccount = new GoodAccount(inventoryBook.getAccount(goodAccountId));

        const goodExcCode = BotService.getExchangeCode(goodAccount.getAccount());
        const financialBook = BotService.getFinancialBook(inventoryBook, goodExcCode);
        if (financialBook == null) {
            return summary;
        }

        const iterator = inventoryBook.getTransactions(helper.getAccountQuery(goodAccount.getName()));

        const transactions: Bkper.Transaction[] = [];
        while (iterator.hasNext()) {
            const tx = iterator.next();
            transactions.push(tx);
        }

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
                    const transactionIterator = financialBook.getTransactions(`remoteId:${tx.getId()}`);
                    if (transactionIterator.hasNext()) {
                        const COGsTransaction = transactionIterator.next();
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
                    const goodPurchaseCost = BkperApp.newAmount(tx.getProperty(GOOD_PURCHASE_COST_PROP));
                    const originalQuantity = BkperApp.newAmount(tx.getProperty(ORIGINAL_QUANTITY_PROP));

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
        processor.fireBatchOperations();

        // Update account
        goodAccount.clearNeedsRebuild();
        goodAccount.setCOGSCalculationDate('');
        goodAccount.update();

        return summary.resetingAsync();
    }

}