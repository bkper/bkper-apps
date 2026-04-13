namespace RealizedResultsService {

    export function resetRealizedResults(stockBookId: string, stockAccountId: string, full: boolean): Summary {
        let stockBook = BkperApp.getBook(stockBookId);
        let stockAccount = new StockAccount(stockBook.getAccount(stockAccountId));
        return resetRealizedResultsForAccountAsync(stockBook, stockAccount, full);
    }

    export function resetRealizedResultsForAccountSync(stockBook: Bkper.Book, stockAccount: StockAccount, full: boolean, resetIterator?: Bkper.TransactionIterator): Summary {

        let iterator: Bkper.TransactionIterator;
        if (resetIterator) {
            iterator = resetIterator;
        } else {
            iterator = stockBook.getTransactions(BotService.getAccountQuery(stockAccount, full));
        }

        let stockAccountSaleTransactions: Bkper.Transaction[] = [];
        let stockAccountPurchaseTransactions: Bkper.Transaction[] = [];

        let stockExcCode = stockAccount.getExchangeCode();
        let financialBook = BotService.getFinancialBook(stockBook, stockExcCode);
        if (financialBook == null) {
            return new Summary(stockAccount.getId());
        }

        const baseBook = BotService.getBaseBook(financialBook);
        const transactions: Bkper.Transaction[] = [];

        while (iterator.hasNext()) {
            let tx = iterator.next();
            transactions.push(tx);
        }

        for (let tx of transactions) {

            // Log operation status
            console.log(`processing transaction: ${tx.getId()}`);

            if (tx.isChecked()) {
                tx = tx.uncheck();
            }

            if (tx.getAgentId() == 'stock-bot') {

                // Trash fwd log
                if (tx.getProperty(FWD_TX_PROP)) {
                    tx.trash();
                    continue;
                }

                // Trash fwd liquidation
                if (tx.getProperty(FWD_LIQUIDATION_PROP)) {
                    // Trash forwarded result
                    let i = financialBook.getTransactions(`remoteId:fwd_${tx.getId()}`);
                    while (i.hasNext()) {
                        let fwdTx = i.next();
                        if (fwdTx.isChecked()) {
                            fwdTx = fwdTx.uncheck();
                        }
                        fwdTx.trash();
                    }
                    tx.trash();
                    continue;
                }

                // Trash transactions connected to liquidations
                if (isLiquidationTransaction(tx)) {

                    // Trash RRs, MTMs and FXs
                    let i = financialBook.getTransactions(`remoteId:${tx.getId()}`);
                    while (i.hasNext()) {
                        let rrTx = i.next();
                        if (rrTx.isChecked()) {
                            rrTx = rrTx.uncheck();
                        }
                        rrTx.trash();
                    }
                    i = financialBook.getTransactions(`remoteId:mtm_${tx.getId()}`);
                    while (i.hasNext()) {
                        let mtmTx = i.next();
                        if (mtmTx.isChecked()) {
                            mtmTx = mtmTx.uncheck();
                        }
                        mtmTx.trash();
                    }
                    i = financialBook.getTransactions(`remoteId:interestmtm_${tx.getId()}`);
                    while (i.hasNext()) {
                        let interestMtmTx = i.next();
                        if (interestMtmTx.isChecked()) {
                            interestMtmTx = interestMtmTx.uncheck();
                        }
                        interestMtmTx.trash();
                    }
                    i = baseBook.getTransactions(`remoteId:fx_${tx.getId()}`);
                    while (i.hasNext()) {
                        let fxTx = i.next();
                        if (fxTx.isChecked()) {
                            fxTx = fxTx.uncheck();
                        }
                        fxTx.trash();
                    }

                }

                // Trash transactions connected to historical liquidations
                if (isHistLiquidationTransaction(tx)) {

                    // Trash RRs, MTMs and FXs
                    let i = financialBook.getTransactions(`remoteId:hist_${tx.getId()}`);
                    while (i.hasNext()) {
                        let rrTx = i.next();
                        if (rrTx.isChecked()) {
                            rrTx = rrTx.uncheck();
                        }
                        rrTx.trash();
                    }
                    i = financialBook.getTransactions(`remoteId:mtm_hist_${tx.getId()}`);
                    while (i.hasNext()) {
                        let mtmTx = i.next();
                        if (mtmTx.isChecked()) {
                            mtmTx = mtmTx.uncheck();
                        }
                        mtmTx.trash();
                    }
                    i = baseBook.getTransactions(`remoteId:fx_hist_${tx.getId()}`);
                    while (i.hasNext()) {
                        let fxTx = i.next();
                        if (fxTx.isChecked()) {
                            fxTx = fxTx.uncheck();
                        }
                        fxTx.trash();
                    }

                }

                let originalAmountProp = tx.getProperty(ORIGINAL_AMOUNT_PROP);
                let originalQuantityProp = tx.getProperty(ORIGINAL_QUANTITY_PROP);

                if (full) {
                    tx.setProperty(ORDER_PROP, tx.getProperty(HIST_ORDER_PROP));
                    if (tx.getProperty(DATE_PROP)) {
                        tx.setDate(tx.getProperty(DATE_PROP));
                    }
                    const histQuantity = tx.getProperty(HIST_QUANTITY_PROP);
                    if (histQuantity) {
                        tx.setProperty(ORIGINAL_QUANTITY_PROP, histQuantity);
                        originalQuantityProp = histQuantity;
                    }
                    tx
                        .deleteProperty(DATE_PROP)
                        .deleteProperty(HIST_ORDER_PROP)
                        .deleteProperty(HIST_QUANTITY_PROP)
                        .deleteProperty(FWD_PURCHASE_PRICE_PROP)
                        .deleteProperty(FWD_SALE_PRICE_PROP)
                        .deleteProperty(FWD_PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                        .deleteProperty(FWD_LOG_PROP)
                    ;
                }

                if (!originalQuantityProp) {
                    tx.trash();
                } else {

                    // Fix wrong negative prices from forwarded date error
                    if (tx.getProperty(FWD_SALE_PRICE_PROP)) {
                        tx.setProperty(FWD_SALE_PRICE_PROP, BkperApp.newAmount(tx.getProperty(FWD_SALE_PRICE_PROP)).abs().toString());
                    }
                    if (tx.getProperty(FWD_PURCHASE_PRICE_PROP)) {
                        tx.setProperty(FWD_PURCHASE_PRICE_PROP, BkperApp.newAmount(tx.getProperty(FWD_PURCHASE_PRICE_PROP)).abs().toString());
                    }

                    tx
                        .deleteProperty(GAIN_AMOUNT_PROP)
                        .deleteProperty(GAIN_AMOUNT_HIST_PROP)
                        .deleteProperty(PURCHASE_AMOUNT_PROP)
                        .deleteProperty('gain_log')
                        .deleteProperty(SALE_AMOUNT_PROP)
                        .deleteProperty(SHORT_SALE_PROP)
                        .deleteProperty(EXC_RATE_PROP)
                        .deleteProperty(PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(SALE_EXC_RATE_PROP)
                        // .deleteProperty(ORIGINAL_AMOUNT_PROP)
                        .deleteProperty(FWD_PURCHASE_AMOUNT_PROP)
                        .deleteProperty(FWD_SALE_AMOUNT_PROP)
                        .deleteProperty(LIQUIDATION_LOG_PROP)
                    ;

                    if (BotService.isSale(tx)) {
                        let salePriceProp = tx.getProperty(SALE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !salePriceProp) {
                            let salePrice = BkperApp.newAmount(originalAmountProp).div(BkperApp.newAmount(originalQuantityProp));
                            tx.setProperty(SALE_PRICE_PROP, salePrice.toString());
                        }
                        tx
                            .deleteProperty(PURCHASE_LOG_PROP)
                            .deleteProperty(PURCHASE_PRICE_PROP)
                            .deleteProperty(FWD_PURCHASE_LOG_PROP)
                            .setAmount(originalQuantityProp)
                            .update()
                        ;
                        stockAccountSaleTransactions.push(tx);
                    } else if (BotService.isPurchase(tx)) {
                        let purchasePriceProp = tx.getProperty(PURCHASE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !purchasePriceProp) {
                            let purchasePrice = BkperApp.newAmount(originalAmountProp).div(BkperApp.newAmount(originalQuantityProp));
                            tx.setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString());
                        }
                        tx
                            .deleteProperty(SALE_DATE_PROP)
                            .deleteProperty(SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                            .setAmount(originalQuantityProp)
                            .update()
                        ;
                        stockAccountPurchaseTransactions.push(tx);
                    }
                }
            }
        }

        stockAccount.clearNeedsRebuild();

        if (full) {
            stockAccount
                .deleteRealizedDate()
                .deleteForwardedDate()
                .deleteForwardedExcRate()
                .deleteForwardedPrice()
            ;
        }

        let forwardedDate = stockAccount.getForwardedDate();
        if (forwardedDate) {
            stockAccount.setRealizedDate(forwardedDate);
        } else {
            stockAccount.deleteRealizedDate();
        }

        stockAccount.update();

        return new Summary(stockAccount.getId()).done();

    }

    export function resetRealizedResultsForAccountAsync(stockBook: Bkper.Book, stockAccount: StockAccount, full: boolean, resetIterator?: Bkper.TransactionIterator): Summary {

        let iterator: Bkper.TransactionIterator;
        if (resetIterator) {
            iterator = resetIterator;
        } else {
            iterator = stockBook.getTransactions(BotService.getAccountQuery(stockAccount, full));
        }

        // Summary
        const summary = new Summary(stockAccount.getId());

        const stockExcCode = stockAccount.getExchangeCode();
        const financialBook = BotService.getFinancialBook(stockBook, stockExcCode);
        // Skip
        if (financialBook == null) {
            return summary;
        }

        const baseBook = BotService.getBaseBook(financialBook);
        const transactions: Bkper.Transaction[] = [];

        while (iterator.hasNext()) {
            let tx = iterator.next();
            transactions.push(tx);
        }

        // Processor
        const processor = new ResetRealizedResultsProcessor(stockBook, financialBook, baseBook);

        for (let tx of transactions) {

            // Log operation status
            console.log(`processing transaction: ${tx.getId()}`);

            if (tx.isChecked()) {
                tx.setChecked(false);
            }

            if (tx.getAgentId() == 'stock-bot') {

                // Trash fwd log
                if (tx.getProperty(FWD_TX_PROP)) {
                    // Store transaction to be trashed
                    processor.setStockBookTransactionToTrash(tx);
                    continue;
                }

                // Trash fwd liquidation
                if (tx.getProperty(FWD_LIQUIDATION_PROP)) {
                    // Trash forwarded result
                    let i = financialBook.getTransactions(`remoteId:fwd_${tx.getId()}`);
                    while (i.hasNext()) {
                        let fwdTx = i.next();
                        if (fwdTx.isChecked()) {
                            fwdTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(fwdTx);
                    }
                    // Store transaction to be trashed
                    processor.setStockBookTransactionToTrash(tx);
                    continue;
                }

                // Trash transactions connected to liquidations
                if (isLiquidationTransaction(tx)) {

                    // RRs
                    let i = financialBook.getTransactions(`remoteId:${tx.getId()}`);
                    while (i.hasNext()) {
                        let rrTx = i.next();
                        if (rrTx.isChecked()) {
                            rrTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(rrTx);
                    }

                    // MTMs
                    i = financialBook.getTransactions(`remoteId:mtm_${tx.getId()}`);
                    while (i.hasNext()) {
                        let mtmTx = i.next();
                        if (mtmTx.isChecked()) {
                            mtmTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(mtmTx);
                    }

                    // Interest MTMs
                    i = financialBook.getTransactions(`remoteId:interestmtm_${tx.getId()}`);
                    while (i.hasNext()) {
                        let interestMtmTx = i.next();
                        if (interestMtmTx.isChecked()) {
                            interestMtmTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(interestMtmTx);
                    }

                    // FXs
                    i = baseBook.getTransactions(`remoteId:fx_${tx.getId()}`);
                    while (i.hasNext()) {
                        let fxTx = i.next();
                        if (fxTx.isChecked()) {
                            fxTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setBaseBookTransactionToTrash(fxTx);
                    }

                }

                // Trash transactions connected to historical liquidations
                if (isHistLiquidationTransaction(tx)) {

                    // RRs
                    let i = financialBook.getTransactions(`remoteId:hist_${tx.getId()}`);
                    while (i.hasNext()) {
                        let rrTx = i.next();
                        if (rrTx.isChecked()) {
                            rrTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(rrTx);
                    }

                    // MTMs
                    i = financialBook.getTransactions(`remoteId:mtm_hist_${tx.getId()}`);
                    while (i.hasNext()) {
                        let mtmTx = i.next();
                        if (mtmTx.isChecked()) {
                            mtmTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(mtmTx);
                    }

                    // FXs
                    i = baseBook.getTransactions(`remoteId:fx_hist_${tx.getId()}`);
                    while (i.hasNext()) {
                        let fxTx = i.next();
                        if (fxTx.isChecked()) {
                            fxTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setBaseBookTransactionToTrash(fxTx);
                    }

                }

                // Reset properties
                let originalAmountProp = tx.getProperty(ORIGINAL_AMOUNT_PROP);
                let originalQuantityProp = tx.getProperty(ORIGINAL_QUANTITY_PROP);

                if (full) {
                    tx.setProperty(ORDER_PROP, tx.getProperty(HIST_ORDER_PROP));
                    if (tx.getProperty(DATE_PROP)) {
                        tx.setDate(tx.getProperty(DATE_PROP));
                    }
                    const histQuantity = tx.getProperty(HIST_QUANTITY_PROP);
                    if (histQuantity) {
                        tx.setProperty(ORIGINAL_QUANTITY_PROP, histQuantity);
                        originalQuantityProp = histQuantity;
                    }
                    tx
                        .deleteProperty(DATE_PROP)
                        .deleteProperty(HIST_ORDER_PROP)
                        .deleteProperty(HIST_QUANTITY_PROP)
                        .deleteProperty(FWD_PURCHASE_PRICE_PROP)
                        .deleteProperty(FWD_SALE_PRICE_PROP)
                        .deleteProperty(FWD_PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                        .deleteProperty(FWD_LOG_PROP)
                    ;
                }

                // Trash splitted transaction
                if (!originalQuantityProp) {

                    // Store transaction to be trashed
                    processor.setStockBookTransactionToTrash(tx);

                    // Reset parent transaction
                } else {

                    // Fix wrong negative prices from forwarded date error
                    if (tx.getProperty(FWD_SALE_PRICE_PROP)) {
                        tx.setProperty(FWD_SALE_PRICE_PROP, BkperApp.newAmount(tx.getProperty(FWD_SALE_PRICE_PROP)).abs().toString());
                    }
                    if (tx.getProperty(FWD_PURCHASE_PRICE_PROP)) {
                        tx.setProperty(FWD_PURCHASE_PRICE_PROP, BkperApp.newAmount(tx.getProperty(FWD_PURCHASE_PRICE_PROP)).abs().toString());
                    }
                    tx
                        .deleteProperty(GAIN_AMOUNT_PROP)
                        .deleteProperty(GAIN_AMOUNT_HIST_PROP)
                        .deleteProperty(PURCHASE_AMOUNT_PROP)
                        .deleteProperty('gain_log')
                        .deleteProperty(SALE_AMOUNT_PROP)
                        .deleteProperty(SHORT_SALE_PROP)
                        .deleteProperty(EXC_RATE_PROP)
                        .deleteProperty(PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(SALE_EXC_RATE_PROP)
                        // .deleteProperty(ORIGINAL_AMOUNT_PROP)
                        .deleteProperty(FWD_PURCHASE_AMOUNT_PROP)
                        .deleteProperty(FWD_SALE_AMOUNT_PROP)
                        .deleteProperty(LIQUIDATION_LOG_PROP)
                    ;
                    // Sales
                    if (BotService.isSale(tx)) {
                        let salePriceProp = tx.getProperty(SALE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !salePriceProp) {
                            let salePrice = BkperApp.newAmount(originalAmountProp).div(BkperApp.newAmount(originalQuantityProp));
                            tx.setProperty(SALE_PRICE_PROP, salePrice.toString());
                        }
                        tx
                            .deleteProperty(PURCHASE_LOG_PROP)
                            .deleteProperty(PURCHASE_PRICE_PROP)
                            .deleteProperty(FWD_PURCHASE_LOG_PROP)
                            .setAmount(originalQuantityProp)
                        ;
                        // Store transaction to be updated
                        processor.setStockBookTransactionToUpdate(tx);
                    // Purchases
                    } else if (BotService.isPurchase(tx)) {
                        let purchasePriceProp = tx.getProperty(PURCHASE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !purchasePriceProp) {
                            let purchasePrice = BkperApp.newAmount(originalAmountProp).div(BkperApp.newAmount(originalQuantityProp));
                            tx.setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString());
                        }
                        tx
                            .deleteProperty(SALE_DATE_PROP)
                            .deleteProperty(SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                            .setAmount(originalQuantityProp)
                        ;
                        // Store transaction to be updated
                        processor.setStockBookTransactionToUpdate(tx);
                    }

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
        stockAccount.clearNeedsRebuild();
        if (full) {
            stockAccount
                .deleteRealizedDate()
                .deleteForwardedDate()
                .deleteForwardedExcRate()
                .deleteForwardedPrice()
            ;
        }

        let forwardedDate = stockAccount.getForwardedDate();
        if (forwardedDate) {
            stockAccount.setRealizedDate(forwardedDate);
        } else {
            stockAccount.deleteRealizedDate();
        }

        stockAccount.update();

        return summary.resetingAsync();

    }

    function isLiquidationTransaction(transaction: Bkper.Transaction): boolean {
        return transaction.getProperty(GAIN_AMOUNT_PROP) ? true : false;
    }

    function isHistLiquidationTransaction(transaction: Bkper.Transaction): boolean {
        return transaction.getProperty(GAIN_AMOUNT_HIST_PROP) ? true : false;
    }

}
