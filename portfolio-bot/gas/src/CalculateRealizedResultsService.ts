namespace RealizedResultsService {

    export function calculateRealizedResultsForAccountAsync(stockBookId: string, stockAccountId: string, autoMtM: boolean, toDate: string): Summary {

        let stockBook = BkperApp.getBook(stockBookId);
        if (!toDate) {
            toDate = stockBook.formatDate(new Date());
        }

        let stockAccount = new StockAccount(stockBook.getAccount(stockAccountId));

        // Calculation model
        const model = BotService.getCalculationModel(stockBook);

        const summary = new Summary(stockAccount.getId());

        if (stockAccount.needsRebuild()) {
            // Fire reset async
            RealizedResultsService.resetRealizedResultsForAccountAsync(stockBook, stockAccount, false);
            return summary.rebuild();
        }

        let stockExcCode = stockAccount.getExchangeCode();
        let financialBook = BotService.getFinancialBook(stockBook, stockExcCode);
        // Skip
        if (financialBook == null) {
            return summary;
        }

        const beforeDate = BotService.getBeforeDateIsoString(stockBook, toDate);
        let iterator = stockBook.getTransactions(BotService.getAccountQuery(stockAccount, false, beforeDate));

        let stockAccountSaleTransactions: Bkper.Transaction[] = [];
        let stockAccountPurchaseTransactions: Bkper.Transaction[] = [];

        while (iterator.hasNext()) {
            const tx = iterator.next();
            // Filter only unchecked
            if (tx.isChecked()) {
                continue;
            }
            if (BotService.isSale(tx)) {
                stockAccountSaleTransactions.push(tx);
            }
            if (BotService.isPurchase(tx)) {
                stockAccountPurchaseTransactions.push(tx);
            }
        }

        stockAccountSaleTransactions = stockAccountSaleTransactions.sort(BotService.compareToFIFO);
        stockAccountPurchaseTransactions = stockAccountPurchaseTransactions.sort(BotService.compareToFIFO);

        const baseBook = BotService.getBaseBook(financialBook);

        // Processor
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        // Process sales
        for (const saleTransaction of stockAccountSaleTransactions) {
            if (stockAccountPurchaseTransactions.length > 0) {
                processSale(baseBook, financialBook, stockExcCode, stockBook, stockAccount, saleTransaction, stockAccountPurchaseTransactions, summary, autoMtM, model, processor);
            }
            // Abort if any transaction is locked
            if (processor.hasLockedTransaction()) {
                return summary.lockError();
            }
        }

        // Check & record exchange rates if missing
        checkAndRecordExchangeRates(baseBook, financialBook, stockAccountSaleTransactions, stockAccountPurchaseTransactions, processor);

        // Check & record Interest account MTM if necessary
        if (autoMtM) {
            const financialInterestAccount = BotService.getInterestAccount(financialBook, stockAccount.getName());
            const lastTransactionId = getLastTransactionId(stockAccountSaleTransactions, stockAccountPurchaseTransactions);
            if (financialInterestAccount && lastTransactionId) {
                checkAndRecordInterestMtm(stockAccount, stockBook, financialInterestAccount, financialBook, toDate, lastTransactionId, summary, processor);
            }
        }

        // Fire batch operations
        processor.fireBatchOperations();

        checkLastTxDate(stockAccount, stockAccountSaleTransactions, stockAccountPurchaseTransactions);

        return summary.calculatingAsync();

    }

    function checkAndRecordExchangeRates(baseBook: Bkper.Book, financialBook: Bkper.Book, saleTransactions: Bkper.Transaction[], purchaseTransactions: Bkper.Transaction[], processor: CalculateRealizedResultsProcessor): void {
        for (const saleTx of saleTransactions) {
            if (!saleTx.isChecked()) {
                recordExcRateProp(baseBook, financialBook, saleTx, SALE_EXC_RATE_PROP, processor);
            }
        }
        for (const purchaseTx of purchaseTransactions) {
            if (!purchaseTx.isChecked()) {
                recordExcRateProp(baseBook, financialBook, purchaseTx, PURCHASE_EXC_RATE_PROP, processor);
            }
        }
    }

    function recordExcRateProp(baseBook: Bkper.Book, financialBook: Bkper.Book, transaction: Bkper.Transaction, exchangeRateProperty: string, processor: CalculateRealizedResultsProcessor): void {
        if (transaction.isChecked()) {
            return;
        }
        const excRateProp = transaction.getProperty(exchangeRateProperty);
        if (!excRateProp) {
            const excRate = BotService.getExcRate(baseBook, financialBook, transaction, exchangeRateProperty);
            transaction.setProperty(exchangeRateProperty, excRate?.toString());
        }
        const fwdExcRateProp = transaction.getProperty(`fwd_${exchangeRateProperty}`);
        if (!fwdExcRateProp) {
            const excRate = BotService.getExcRate(baseBook, financialBook, transaction, exchangeRateProperty);
            const fwdExcRate = BotService.getFwdExcRate(transaction, `fwd_${exchangeRateProperty}`, excRate);
            transaction.setProperty(`fwd_${exchangeRateProperty}`, fwdExcRate?.toString());
        }
        // Update transaction if necessary
        if (!excRateProp || !fwdExcRateProp) {
            // Store transaction to be updated
            processor.setStockBookTransactionToUpdate(transaction);
        }
    }

    function checkAndRecordInterestMtm(principalStockAccount: StockAccount, stockBook: Bkper.Book, financialInterestAccount: Bkper.Account, financialBook: Bkper.Book, onDateIso: string, lastTransactionId: string, summary: Summary, processor: CalculateRealizedResultsProcessor): void {
        // Check principal account quantity on Stock Book
        const principalQuantity = getAccountBalance(stockBook, principalStockAccount, stockBook.parseDate(onDateIso));
        if (principalQuantity.eq(0)) {
            // Check interest account balance on Financial Book
            const interestBalance = getAccountBalance(financialBook, financialInterestAccount, financialBook.parseDate(onDateIso));
            if (!interestBalance.eq(0)) {
                // Record interest account MTM on financial book
                const financialUnrealizedAccount = getUnrealizedAccount(financialBook, financialInterestAccount);
                recordInterestAccountMtm(financialBook, financialInterestAccount, financialUnrealizedAccount, interestBalance, onDateIso, lastTransactionId, processor);
            }
        }
    }

    function checkLastTxDate(stockAccount: StockAccount, stockAccountSaleTransactions: Bkper.Transaction[], stockAccountPurchaseTransactions: Bkper.Transaction[]) {
        let lastSaleTx = stockAccountSaleTransactions.length > 0 ? stockAccountSaleTransactions[stockAccountSaleTransactions.length - 1] : null;
        let lastPurchaseTx = stockAccountPurchaseTransactions.length > 0 ? stockAccountPurchaseTransactions[stockAccountPurchaseTransactions.length - 1] : null;

        let lastTxDateValue = lastSaleTx != null ? lastSaleTx.getDateValue() : null;
        let lastTxDate = lastSaleTx != null ? lastSaleTx.getDate() : null;
        if ((lastTxDateValue == null && lastPurchaseTx != null) || (lastPurchaseTx != null && lastPurchaseTx.getDateValue() > +lastTxDateValue)) {
            lastTxDate = lastPurchaseTx.getDate();
            lastTxDateValue = lastPurchaseTx.getDateValue();
        }
        let stockAccountLastTxDateValue = stockAccount.getRealizedDateValue();
        if (lastTxDateValue != null && (stockAccountLastTxDateValue == null || lastTxDateValue > stockAccountLastTxDateValue)) {
            stockAccount.setRealizedDate(lastTxDate).update();
        }
    }

    function logLiquidation(transaction: Bkper.Transaction, price: Bkper.Amount, excRate: Bkper.Amount): LiquidationLogEntry {
        return {
            id: transaction.getId(),
            dt: transaction.getDate(),
            qt: transaction.getAmount().toString(),
            pr: price.toString(),
            rt: excRate?.toString()
        }
    }

    function logPurchase(stockBook: Bkper.Book, quantity: Bkper.Amount, price: Bkper.Amount, transaction: Bkper.Transaction, excRate: Bkper.Amount): PurchaseLogEntry {
        return {
            qt: quantity.toString(),
            pr: price.toString(),
            dt: transaction.getProperty(DATE_PROP) || transaction.getDate(),
            rt: excRate?.toString()
        }
    }

    function isShortSale(purchaseTransaction: Bkper.Transaction, saleTransaction: Bkper.Transaction): boolean {
        return BotService.compareToFIFO(saleTransaction, purchaseTransaction) < 0;
    }

    function processSale(
        baseBook: Bkper.Book,
        financialBook: Bkper.Book,
        stockExcCode: string,
        stockBook: Bkper.Book,
        stockAccount: StockAccount,
        saleTransaction: Bkper.Transaction,
        purchaseTransactions: Bkper.Transaction[],
        summary: Summary,
        autoMtM: boolean,
        model: CalculationModel,
        processor: CalculateRealizedResultsProcessor
    ): void {

        // Log operation status
        console.log(`processing sale: ${saleTransaction.getId()}`);

        // Sale info: quantity, prices, exchange rates
        let soldQuantity = saleTransaction.getAmount();
        const salePrice = BotService.getHistSalePrice(saleTransaction);
        const fwdSalePrice = BotService.getSalePrice(saleTransaction);
        const saleExcRate = BotService.getExcRate(baseBook, financialBook, saleTransaction, SALE_EXC_RATE_PROP);
        const fwdSaleExcRate = BotService.getFwdExcRate(saleTransaction, FWD_SALE_EXC_RATE_PROP, saleExcRate);

        let purchaseTotal = BkperApp.newAmount(0);
        let saleTotal = BkperApp.newAmount(0);

        // Historical gain
        let histGainTotal = BkperApp.newAmount(0);
        let histGainBaseNoFxTotal = BkperApp.newAmount(0);
        let histGainBaseWithFxTotal = BkperApp.newAmount(0);
        // Fair gain
        let gainTotal = BkperApp.newAmount(0);
        let gainBaseNoFxTotal = BkperApp.newAmount(0);
        let gainBaseWithFxTotal = BkperApp.newAmount(0);

        let fwdPurchaseTotal = BkperApp.newAmount(0);
        let fwdSaleTotal = BkperApp.newAmount(0);

        const excAggregateProp = baseBook.getProperty(EXC_AGGREGATE_PROP);
        // Unrealized accounts
        const unrealizedAccount = getUnrealizedAccount(financialBook, stockAccount);
        const unrealizedFxBaseAccount = getUnrealizedFxBaseAccount(baseBook, stockAccount, excAggregateProp);
        // Unrealized Hist accounts - only needed if calculating BOTH historical and fair results
        const unrealizedHistAccount = (model === CalculationModel.BOTH) ? getUnrealizedHistAccount(financialBook, stockAccount) : null;
        const unrealizedFxHistBaseAccount = (model === CalculationModel.BOTH) ? getUnrealizedFxHistBaseAccount(baseBook, stockAccount, excAggregateProp) : null;

        let purchaseLogEntries: PurchaseLogEntry[] = [];
        let fwdPurchaseLogEntries: PurchaseLogEntry[] = [];

        let shortSaleLiquidationLogEntries: LiquidationLogEntry[] = [];

        // Control liquidation status
        let purchaseProcessed = false;

        for (const purchaseTransaction of purchaseTransactions) {

            // Log operation status
            console.log(`processing purchase: ${purchaseTransaction.getId()}`);

            let longSaleLiquidationLogEntries: LiquidationLogEntry[] = [];

            if (purchaseTransaction.isChecked()) {
                // Only process unchecked purchases
                continue;
            }

            // Processing purchase
            purchaseProcessed = true;

            const shortSale = isShortSale(purchaseTransaction, saleTransaction);

            // Purchase info: quantity, prices, exchange rates
            const purchasePrice = BotService.getHistPurchasePrice(purchaseTransaction);
            const fwdPurchasePrice = BotService.getPurchasePrice(purchaseTransaction);
            const purchaseExcRate = BotService.getExcRate(baseBook, financialBook, purchaseTransaction, PURCHASE_EXC_RATE_PROP);
            const fwdPurchaseExcRate = BotService.getFwdExcRate(purchaseTransaction, FWD_PURCHASE_EXC_RATE_PROP, purchaseExcRate);

            const purchaseQuantity = purchaseTransaction.getAmount();

            // Sold quantity GTE purchase quantity: update & check purchase transaction
            if (soldQuantity.gte(purchaseQuantity)) {

                const saleAmount = salePrice.times(purchaseQuantity);
                const purchaseAmount = purchasePrice.times(purchaseQuantity);
                const fwdSaleAmount = fwdSalePrice.times(purchaseQuantity);
                const fwdPurchaseAmount = fwdPurchasePrice.times(purchaseQuantity);

                // Historical gain
                let histGain = saleAmount.minus(purchaseAmount);
                let histGainBaseNoFx = BotService.calculateGainBaseNoFX(histGain, purchaseExcRate, saleExcRate, shortSale);
                let histGainBaseWithFx = BotService.calculateGainBaseWithFX(purchaseAmount, purchaseExcRate, saleAmount, saleExcRate);

                // Fair gain
                let gain = fwdSaleAmount.minus(fwdPurchaseAmount);
                let gainBaseNoFx = BotService.calculateGainBaseNoFX(gain, fwdPurchaseExcRate, fwdSaleExcRate, shortSale);
                let gainBaseWithFx = BotService.calculateGainBaseWithFX(fwdPurchaseAmount, fwdPurchaseExcRate, fwdSaleAmount, fwdSaleExcRate);

                if (!shortSale) {
                    purchaseTotal = purchaseTotal.plus(purchaseAmount);
                    saleTotal = saleTotal.plus(saleAmount);
                    fwdPurchaseTotal = fwdPurchaseTotal.plus(fwdPurchaseAmount);
                    fwdSaleTotal = fwdSaleTotal.plus(fwdSaleAmount);

                    // Historical
                    histGainTotal = histGainTotal.plus(histGain);
                    histGainBaseNoFxTotal = histGainBaseNoFxTotal.plus(histGainBaseNoFx);
                    histGainBaseWithFxTotal = histGainBaseWithFxTotal.plus(histGainBaseWithFx);
                    // Fair
                    gainTotal = gainTotal.plus(gain);
                    gainBaseNoFxTotal = gainBaseNoFxTotal.plus(gainBaseNoFx);
                    gainBaseWithFxTotal = gainBaseWithFxTotal.plus(gainBaseWithFx);

                    purchaseLogEntries.push(logPurchase(stockBook, purchaseQuantity, purchasePrice, purchaseTransaction, purchaseExcRate));
                    if (fwdPurchasePrice) {
                        fwdPurchaseLogEntries.push(logPurchase(stockBook, purchaseQuantity, fwdPurchasePrice, purchaseTransaction, fwdPurchaseExcRate));
                    } else {
                        fwdPurchaseLogEntries.push(logPurchase(stockBook, purchaseQuantity, purchasePrice, purchaseTransaction, purchaseExcRate));
                    }
                }

                purchaseTransaction
                    .setProperty(PURCHASE_AMOUNT_PROP, purchaseAmount.toString())
                    .setProperty(PURCHASE_EXC_RATE_PROP, purchaseExcRate?.toString())
                    .setProperty(FWD_PURCHASE_AMOUNT_PROP, fwdPurchaseAmount?.toString())
                ;
                // Avoid overriding purchase_price prop when purchase_price_hist value is present
                if (!purchaseTransaction.getProperty(PURCHASE_PRICE_HIST_PROP)) {
                    purchaseTransaction.setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString());
                }
                if (shortSale) {
                    shortSaleLiquidationLogEntries.push(logLiquidation(purchaseTransaction, purchasePrice, purchaseExcRate));
                    purchaseTransaction
                        .setProperty(SALE_PRICE_PROP, salePrice.toString())
                        .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                        .setProperty(SALE_AMOUNT_PROP, saleAmount.toString())
                        .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                        .setProperty(FWD_SALE_PRICE_PROP, fwdSalePrice?.toString())
                        .setProperty(FWD_SALE_AMOUNT_PROP, fwdSaleAmount?.toString())
                        .setProperty(SALE_DATE_PROP, saleTransaction.getProperty(DATE_PROP) || saleTransaction.getDate())
                        .setProperty(SHORT_SALE_PROP, 'true')
                    ;
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical gain only - use standard property key
                        purchaseTransaction.setProperty(GAIN_AMOUNT_PROP, histGain.toString());
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair gain only - use standard property key
                        purchaseTransaction.setProperty(GAIN_AMOUNT_PROP, gain.toString());
                    } else {
                        // Record both gains - each one uses its own property key
                        purchaseTransaction
                            .setProperty(GAIN_AMOUNT_HIST_PROP, histGain.toString())
                            .setProperty(GAIN_AMOUNT_PROP, gain.toString())
                        ;
                    }
                } else {
                    longSaleLiquidationLogEntries.push(logLiquidation(saleTransaction, salePrice, saleExcRate));
                    purchaseTransaction.setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(longSaleLiquidationLogEntries));
                }

                // Store transaction to be updated
                purchaseTransaction.setChecked(true);
                processor.setStockBookTransactionToUpdate(purchaseTransaction);

                if (shortSale) {
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical results only - use standard accounts and remoteId prefixes
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, purchaseTransaction, histGain, histGainBaseNoFx, false, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, purchaseTransaction, histGainBaseWithFx, histGainBaseNoFx, summary, false, processor);
                        if (autoMtM) {
                            addMarkToMarket(stockBook, purchaseTransaction, stockAccount, financialBook, unrealizedAccount, purchasePrice, false, processor);
                        }
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair results only - use standard accounts and remoteId prefixes
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, purchaseTransaction, gain, gainBaseNoFx, false, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, purchaseTransaction, gainBaseWithFx, gainBaseNoFx, summary, false, processor);
                        if (autoMtM) {
                            addMarkToMarket(stockBook, purchaseTransaction, stockAccount, financialBook, unrealizedAccount, purchasePrice, false, processor);
                        }
                    } else {
                        // Record both results - each one uses its accounts and remoteId prefixes
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedHistAccount, purchaseTransaction, histGain, histGainBaseNoFx, true, processor);
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, purchaseTransaction, gain, gainBaseNoFx, false, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxHistBaseAccount, purchaseTransaction, histGainBaseWithFx, histGainBaseNoFx, summary, true, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, purchaseTransaction, gainBaseWithFx, gainBaseNoFx, summary, false, processor);
                        if (autoMtM) {
                            addMarkToMarket(stockBook, purchaseTransaction, stockAccount, financialBook, unrealizedHistAccount, purchasePrice, true, processor);
                            addMarkToMarket(stockBook, purchaseTransaction, stockAccount, financialBook, unrealizedAccount, purchasePrice, false, processor);
                        }
                    }
                }

                soldQuantity = soldQuantity.minus(purchaseQuantity);

            // Sold quantity LT purchase quantity: update purchase + update & check splitted purchase transaction
            } else {

                let remainingBuyQuantity = purchaseQuantity.minus(soldQuantity);
                let partialBuyQuantity = purchaseQuantity.minus(remainingBuyQuantity);

                const saleAmount = salePrice.times(partialBuyQuantity);
                const purchaseAmount = purchasePrice.times(partialBuyQuantity);
                const fwdSaleAmount = fwdSalePrice.times(partialBuyQuantity);
                const fwdPurchaseAmount = fwdPurchasePrice.times(partialBuyQuantity);

                // Historical
                let histGain = saleAmount.minus(purchaseAmount);
                let histGainBaseNoFx = BotService.calculateGainBaseNoFX(histGain, purchaseExcRate, saleExcRate, shortSale);
                let histGainBaseWithFx = BotService.calculateGainBaseWithFX(purchaseAmount, purchaseExcRate, saleAmount, saleExcRate);
                // Fair
                let gain = fwdSaleAmount.minus(fwdPurchaseAmount);
                let gainBaseNoFx = BotService.calculateGainBaseNoFX(gain, fwdPurchaseExcRate, fwdSaleExcRate, shortSale);
                let gainBaseWithFx = BotService.calculateGainBaseWithFX(fwdPurchaseAmount, fwdPurchaseExcRate, fwdSaleAmount, fwdSaleExcRate);

                purchaseTransaction
                    .setAmount(remainingBuyQuantity)
                    .setProperty(PURCHASE_EXC_RATE_PROP, purchaseExcRate?.toString())
                    .setProperty(FWD_PURCHASE_EXC_RATE_PROP, fwdPurchaseExcRate?.toString())
                ;
                // Store transaction to be updated
                processor.setStockBookTransactionToUpdate(purchaseTransaction);

                let splittedPurchaseTransaction = stockBook.newTransaction()
                    .setDate(purchaseTransaction.getDate())
                    .setAmount(partialBuyQuantity)
                    .setCreditAccount(purchaseTransaction.getCreditAccount())
                    .setDebitAccount(purchaseTransaction.getDebitAccount())
                    .setDescription(purchaseTransaction.getDescription())
                    .setProperty(ORDER_PROP, purchaseTransaction.getProperty(ORDER_PROP))
                    .setProperty(DATE_PROP, purchaseTransaction.getProperty(DATE_PROP))
                    .setProperty(PARENT_ID, purchaseTransaction.getId())
                    .setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString())
                    .setProperty(PURCHASE_AMOUNT_PROP, purchaseAmount.toString())
                    .setProperty(PURCHASE_EXC_RATE_PROP, purchaseExcRate?.toString())
                    .setProperty(FWD_PURCHASE_PRICE_PROP, fwdPurchasePrice?.toString())
                    .setProperty(FWD_PURCHASE_AMOUNT_PROP, fwdPurchaseAmount?.toString())
                    .setProperty(FWD_PURCHASE_EXC_RATE_PROP, fwdPurchaseExcRate?.toString())
                ;
                if (shortSale) {
                    splittedPurchaseTransaction
                        .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                        .setProperty(SALE_PRICE_PROP, salePrice.toString())
                        .setProperty(SALE_AMOUNT_PROP, saleAmount.toString())
                        .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                        .setProperty(FWD_SALE_PRICE_PROP, fwdSalePrice?.toString())
                        .setProperty(FWD_SALE_AMOUNT_PROP, fwdSaleAmount?.toString())
                        .setProperty(SALE_DATE_PROP, saleTransaction.getProperty(DATE_PROP) || saleTransaction.getDate())
                        .setProperty(SHORT_SALE_PROP, 'true')
                    ;
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical gain only - use standard property key
                        splittedPurchaseTransaction.setProperty(GAIN_AMOUNT_PROP, histGain.toString());
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair gain only - use standard property key
                        splittedPurchaseTransaction.setProperty(GAIN_AMOUNT_PROP, gain.toString());
                    } else {
                        // Record both gains - each one uses its own property key
                        splittedPurchaseTransaction
                            .setProperty(GAIN_AMOUNT_HIST_PROP, histGain.toString())
                            .setProperty(GAIN_AMOUNT_PROP, gain.toString())
                        ;
                    }
                } else {
                    longSaleLiquidationLogEntries.push(logLiquidation(saleTransaction, salePrice, saleExcRate));
                    splittedPurchaseTransaction.setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(longSaleLiquidationLogEntries));
                }

                // Store transaction to be created: generate temporaty id in order to wrap up connections later
                splittedPurchaseTransaction
                    .setChecked(true)
                    .addRemoteId(`${processor.generateTemporaryId()}`)
                ;
                processor.setStockBookTransactionToCreate(splittedPurchaseTransaction);

                if (shortSale) {
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical results only - use standard accounts and remoteId prefixes
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, splittedPurchaseTransaction, histGain, histGainBaseNoFx, false, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, splittedPurchaseTransaction, histGainBaseWithFx, histGainBaseNoFx, summary, false, processor);
                        if (autoMtM) {
                            addMarkToMarket(stockBook, splittedPurchaseTransaction, stockAccount, financialBook, unrealizedAccount, purchasePrice, false, processor);
                        }
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair results only - use standard accounts and remoteId prefixes
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, splittedPurchaseTransaction, gain, gainBaseNoFx, false, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, splittedPurchaseTransaction, gainBaseWithFx, gainBaseNoFx, summary, false, processor);
                        if (autoMtM) {
                            addMarkToMarket(stockBook, splittedPurchaseTransaction, stockAccount, financialBook, unrealizedAccount, purchasePrice, false, processor);
                        }
                    } else {
                        // Record both results - each one uses its accounts and remoteId prefixes
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedHistAccount, splittedPurchaseTransaction, histGain, histGainBaseNoFx, true, processor);
                        addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, splittedPurchaseTransaction, gain, gainBaseNoFx, false, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxHistBaseAccount, splittedPurchaseTransaction, histGainBaseWithFx, histGainBaseNoFx, summary, true, processor);
                        addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, splittedPurchaseTransaction, gainBaseWithFx, gainBaseNoFx, summary, false, processor);
                        if (autoMtM) {
                            addMarkToMarket(stockBook, splittedPurchaseTransaction, stockAccount, financialBook, unrealizedHistAccount, purchasePrice, true, processor);
                            addMarkToMarket(stockBook, splittedPurchaseTransaction, stockAccount, financialBook, unrealizedAccount, purchasePrice, false, processor);
                        }
                    }
                    shortSaleLiquidationLogEntries.push(logLiquidation(splittedPurchaseTransaction, purchasePrice, purchaseExcRate));
                }

                soldQuantity = soldQuantity.minus(partialBuyQuantity);

                if (!shortSale) {
                    purchaseTotal = purchaseTotal.plus(purchaseAmount);
                    saleTotal = saleTotal.plus(saleAmount);
                    fwdSaleTotal = fwdSaleTotal.plus(fwdSaleAmount);
                    fwdPurchaseTotal = fwdPurchaseTotal.plus(fwdPurchaseAmount);

                    // Historical
                    histGainTotal = histGainTotal.plus(histGain);
                    histGainBaseNoFxTotal = histGainBaseNoFxTotal.plus(histGainBaseNoFx);
                    histGainBaseWithFxTotal = histGainBaseWithFxTotal.plus(histGainBaseWithFx);
                    // Fair
                    gainTotal = gainTotal.plus(gain);
                    gainBaseNoFxTotal = gainBaseNoFxTotal.plus(gainBaseNoFx);
                    gainBaseWithFxTotal = gainBaseWithFxTotal.plus(gainBaseWithFx);

                    purchaseLogEntries.push(logPurchase(stockBook, partialBuyQuantity, purchasePrice, purchaseTransaction, purchaseExcRate));
                    if (fwdPurchasePrice) {
                        fwdPurchaseLogEntries.push(logPurchase(stockBook, partialBuyQuantity, fwdPurchasePrice, purchaseTransaction, fwdPurchaseExcRate));
                    } else {
                        fwdPurchaseLogEntries.push(logPurchase(stockBook, partialBuyQuantity, purchasePrice, purchaseTransaction, purchaseExcRate));
                    }
                }

            }

            // Break loop if sale is fully processed, otherwise proceed to next purchase
            if (soldQuantity.lte(0)) {
                break;
            }

        }

        // Sold quantity EQ zero: update & check sale transaction
        if (soldQuantity.round(stockBook.getFractionDigits()).eq(0)) {

            if (shortSaleLiquidationLogEntries.length > 0) {
                saleTransaction
                    .setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(shortSaleLiquidationLogEntries))
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                    .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                ;
            }
            if (purchaseLogEntries.length > 0) {
                saleTransaction
                    .setProperty(PURCHASE_AMOUNT_PROP, purchaseTotal.toString())
                    .setProperty(SALE_AMOUNT_PROP, saleTotal.toString())
                    .setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries))
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                ;
                if (model === CalculationModel.HISTORICAL_ONLY) {
                    // Record historical gain only - use standard property key
                    saleTransaction.setProperty(GAIN_AMOUNT_PROP, histGainTotal.toString());
                } else if (model === CalculationModel.FAIR_ONLY) {
                    // Record fair gain only - use standard property key
                    saleTransaction.setProperty(GAIN_AMOUNT_PROP, gainTotal.toString());
                } else {
                    // Record both gains - each one uses its own property key
                    saleTransaction
                        .setProperty(GAIN_AMOUNT_HIST_PROP, histGainTotal.toString())
                        .setProperty(GAIN_AMOUNT_PROP, gainTotal.toString())
                    ;
                }
                if (fwdPurchaseLogEntries.length > 0) {
                    saleTransaction
                        .setProperty(FWD_PURCHASE_AMOUNT_PROP, !fwdPurchaseTotal.eq(0) ? fwdPurchaseTotal?.toString() : null)
                        .setProperty(FWD_SALE_AMOUNT_PROP, !fwdSaleTotal.eq(0) ? fwdSaleTotal.toString() : null)
                        .setProperty(FWD_PURCHASE_LOG_PROP, JSON.stringify(fwdPurchaseLogEntries))
                        .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                    ;
                }
            }

            // Store transaction to be updated
            saleTransaction.setChecked(true);
            processor.setStockBookTransactionToUpdate(saleTransaction);

        // Sold quantity GT zero: update sale + update & check splitted sale transaction
        } else if (soldQuantity.round(stockBook.getFractionDigits()).gt(0)) {

            let remainingSaleQuantity = saleTransaction.getAmount().minus(soldQuantity);

            if (!remainingSaleQuantity.eq(0)) {

                saleTransaction
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                    .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                    .setAmount(soldQuantity)
                ;
                // Store transaction to be updated
                processor.setStockBookTransactionToUpdate(saleTransaction);

                let splittedSaleTransaction = stockBook.newTransaction()
                    .setDate(saleTransaction.getDate())
                    .setAmount(remainingSaleQuantity)
                    .setCreditAccount(saleTransaction.getCreditAccount())
                    .setDebitAccount(saleTransaction.getDebitAccount())
                    .setDescription(saleTransaction.getDescription())
                    .setProperty(ORDER_PROP, saleTransaction.getProperty(ORDER_PROP))
                    .setProperty(DATE_PROP, saleTransaction.getProperty(DATE_PROP))
                    .setProperty(PARENT_ID, saleTransaction.getId())
                    .setProperty(SALE_PRICE_PROP, salePrice.toString())
                    .setProperty(SALE_EXC_RATE_PROP, saleExcRate?.toString())
                    .setProperty(FWD_SALE_PRICE_PROP, fwdSalePrice?.toString())
                    .setProperty(FWD_SALE_EXC_RATE_PROP, fwdSaleExcRate?.toString())
                ;
                if (shortSaleLiquidationLogEntries.length > 0) {
                    splittedSaleTransaction.setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(shortSaleLiquidationLogEntries));
                }
                if (purchaseLogEntries.length > 0) {
                    splittedSaleTransaction
                        .setProperty(PURCHASE_AMOUNT_PROP, purchaseTotal.toString())
                        .setProperty(SALE_AMOUNT_PROP, saleTotal.toString())
                        .setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries))
                    ;
                    if (model === CalculationModel.HISTORICAL_ONLY) {
                        // Record historical gain only - use standard property key
                        splittedSaleTransaction.setProperty(GAIN_AMOUNT_PROP, histGainTotal.toString());
                    } else if (model === CalculationModel.FAIR_ONLY) {
                        // Record fair gain only - use standard property key
                        splittedSaleTransaction.setProperty(GAIN_AMOUNT_PROP, gainTotal.toString());
                    } else {
                        // Record both gains - each one uses its own property key
                        splittedSaleTransaction
                            .setProperty(GAIN_AMOUNT_HIST_PROP, histGainTotal.toString())
                            .setProperty(GAIN_AMOUNT_PROP, gainTotal.toString())
                        ;
                    }
                    if (fwdPurchaseLogEntries.length > 0) {
                        splittedSaleTransaction
                            .setProperty(FWD_PURCHASE_AMOUNT_PROP, !fwdPurchaseTotal.eq(0) ? fwdPurchaseTotal?.toString() : null)
                            .setProperty(FWD_SALE_AMOUNT_PROP, !fwdSaleTotal.eq(0) ? fwdSaleTotal.toString() : null)
                            .setProperty(FWD_PURCHASE_LOG_PROP, JSON.stringify(fwdPurchaseLogEntries))
                        ;
                    }
                }

                // Store transaction to be created: generate temporaty id in order to wrap up connections later
                splittedSaleTransaction
                    .setChecked(true)
                    .addRemoteId(`${processor.generateTemporaryId()}`)
                ;
                processor.setStockBookTransactionToCreate(splittedSaleTransaction);

                // Override to have the RR, FX and MTM associated to the splitted tx
                saleTransaction = splittedSaleTransaction;
            }

        }

        if (model === CalculationModel.HISTORICAL_ONLY) {
            // Record historical results only - use standard accounts and remoteId prefixes
            addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, saleTransaction, histGainTotal, histGainBaseNoFxTotal, false, processor);
            addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, saleTransaction, histGainBaseWithFxTotal, histGainBaseNoFxTotal, summary, false, processor);
            if (autoMtM && purchaseProcessed && !saleTransaction.getProperty(LIQUIDATION_LOG_PROP)) {
                addMarkToMarket(stockBook, saleTransaction, stockAccount, financialBook, unrealizedAccount, salePrice, false, processor);
            }
        } else if (model === CalculationModel.FAIR_ONLY) {
            // Record fair results only - use standard accounts and remoteId prefixes
            addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, saleTransaction, gainTotal, gainBaseNoFxTotal, false, processor);
            addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, saleTransaction, gainBaseWithFxTotal, gainBaseNoFxTotal, summary, false, processor);
            if (autoMtM && purchaseProcessed && !saleTransaction.getProperty(LIQUIDATION_LOG_PROP)) {
                addMarkToMarket(stockBook, saleTransaction, stockAccount, financialBook, unrealizedAccount, salePrice, false, processor);
            }
        } else {
            // Record both results - each one uses its accounts and remoteId prefixes
            addRealizedResult(baseBook, stockAccount, financialBook, unrealizedHistAccount, saleTransaction, histGainTotal, histGainBaseNoFxTotal, true, processor);
            addRealizedResult(baseBook, stockAccount, financialBook, unrealizedAccount, saleTransaction, gainTotal, gainBaseNoFxTotal, false, processor);
            addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxHistBaseAccount, saleTransaction, histGainBaseWithFxTotal, histGainBaseNoFxTotal, summary, true, processor);
            addFxResult(stockAccount, stockExcCode, baseBook, unrealizedFxBaseAccount, saleTransaction, gainBaseWithFxTotal, gainBaseNoFxTotal, summary, false, processor);
            if (autoMtM && purchaseProcessed && !saleTransaction.getProperty(LIQUIDATION_LOG_PROP)) {
                addMarkToMarket(stockBook, saleTransaction, stockAccount, financialBook, unrealizedHistAccount, salePrice, true, processor);
                addMarkToMarket(stockBook, saleTransaction, stockAccount, financialBook, unrealizedAccount, salePrice, false, processor);
            }
        }

    }

    function addRealizedResult(
        baseBook: Bkper.Book,
        stockAccount: StockAccount,
        financialBook: Bkper.Book,
        unrealizedAccount: Bkper.Account,
        transaction: Bkper.Transaction,
        gain: Bkper.Amount,
        gainBaseNoFX: Bkper.Amount,
        shouldRecordAsHistResult: boolean,
        processor: CalculateRealizedResultsProcessor
    ) {

        const gainDate = transaction.getProperty(DATE_PROP) || transaction.getDate();
        const isBaseBook = baseBook.getId() == financialBook.getId();

        if (gain.round(MAX_DECIMAL_PLACES).gt(0)) {

            // Realized account
            let realizedAccount: Bkper.Account | null = null;

            // Try old XXX Realized Gain account
            if (!shouldRecordAsHistResult) {
                realizedAccount = financialBook.getAccount(`${stockAccount.getName()} Realized Gain`);
            }
            // XXX Realized OR XXX Realized Hist
            if (!realizedAccount) {
                realizedAccount = getRealizedAccount(financialBook, stockAccount, shouldRecordAsHistResult);
            }

            const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
            const remoteId = shouldRecordAsHistResult ? `hist_${baseRemoteId}` : `${baseRemoteId}`;

            const description = shouldRecordAsHistResult ? '#stock_gain_hist' : '#stock_gain';

            const rrTransaction = financialBook.newTransaction()
                .addRemoteId(remoteId)
                .setDate(gainDate)
                .setAmount(gain)
                .setDescription(description)
                .setProperty(EXC_AMOUNT_PROP, getStockGainLossTransactionExcAmountProp(financialBook, isBaseBook, gainBaseNoFX))
                .setProperty(EXC_CODE_PROP, getStockGainLossTransactionExcCodeProp(financialBook, isBaseBook, baseBook))
                .from(realizedAccount)
                .to(unrealizedAccount)
                .setChecked(true)
            ;

            // Store transaction to be created
            processor.setFinancialBookTransactionToCreate(rrTransaction);

        } else if (gain.round(MAX_DECIMAL_PLACES).lt(0)) {

            // Realized account
            let realizedAccount: Bkper.Account | null = null;

            // Try old XXX Realized Loss account
            if (!shouldRecordAsHistResult) {
                realizedAccount = financialBook.getAccount(`${stockAccount.getName()} Realized Loss`);
            }
            // XXX Realized OR XXX Realized Hist
            if (!realizedAccount) {
                realizedAccount = getRealizedAccount(financialBook, stockAccount, shouldRecordAsHistResult);
            }

            const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
            const remoteId = shouldRecordAsHistResult ? `hist_${baseRemoteId}` : `${baseRemoteId}`;

            const description = shouldRecordAsHistResult ? '#stock_loss_hist' : '#stock_loss';

            const rrTransaction = financialBook.newTransaction()
                .addRemoteId(remoteId)
                .setDate(gainDate)
                .setAmount(gain)
                .setDescription(description)
                .setProperty(EXC_AMOUNT_PROP, getStockGainLossTransactionExcAmountProp(financialBook, isBaseBook, gainBaseNoFX))
                .setProperty(EXC_CODE_PROP, getStockGainLossTransactionExcCodeProp(financialBook, isBaseBook, baseBook))
                .from(unrealizedAccount)
                .to(realizedAccount)
                .setChecked(true)
            ;

            // Store transaction to be created
            processor.setFinancialBookTransactionToCreate(rrTransaction);

        }
    }

    function getStockGainLossTransactionExcAmountProp(financialBook: Bkper.Book, isBaseBook: boolean, gainBaseNoFX: Bkper.Amount): string {
        if (!BotService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : gainBaseNoFX.abs().toString();
    }

    function getStockGainLossTransactionExcCodeProp(financialBook: Bkper.Book, isBaseBook: boolean, baseBook: Bkper.Book): string {
        if (!BotService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : BotService.getExcCode(baseBook);
    }

    // function trackAccountCreated(summary: Summary, stockExcCode: string, account: Bkper.Account) {
    //     summary.addCreatedAccount(stockExcCode, account.getName());
    // }

    function addMarkToMarket(
        stockBook: Bkper.Book,
        transaction: Bkper.Transaction,
        stockAccount: StockAccount,
        financialBook: Bkper.Book,
        unrealizedAccount: Bkper.Account,
        price: Bkper.Amount,
        shouldRecordAsHistResult: boolean,
        processor: CalculateRealizedResultsProcessor
    ): void {

        // Remote id
        const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
        const remoteId = shouldRecordAsHistResult ? `mtm_hist_${baseRemoteId}` : `mtm_${baseRemoteId}`;
        // Date
        const isoDate = transaction.getProperty(DATE_PROP) || transaction.getDate();
        const date = stockBook.parseDate(isoDate);
        // Quantity amount
        const totalQuantity = getAccountBalance(stockBook, stockAccount, date);
        // Accounts
        const instrumentAccount = financialBook.getAccount(stockAccount.getName());
        const contraAccount = shouldRecordAsHistResult ? BotService.getSupportAccount(financialBook, stockAccount, MTM_SUFFIX, BotService.getTypeByAccountSuffix(financialBook, MTM_SUFFIX)) : instrumentAccount;
        // Financial amount
        const balance = getAccountBalance(financialBook, instrumentAccount, date);
        const newBalance = totalQuantity.times(price);
        const amount = shouldRecordAsHistResult ? newBalance.minus(balance.plus(processor.getHistMtmBalance(isoDate))) : newBalance.minus(balance.plus(processor.getMtmBalance(isoDate)));

        if (amount.round(MAX_DECIMAL_PLACES).gt(0)) {
            const mtmTx = financialBook.newTransaction()
                .setDate(date)
                .setAmount(amount)
                .setDescription(`#mtm`)
                .setProperty(PRICE_PROP, financialBook.formatAmount(price))
                .setProperty(OPEN_QUANTITY_PROP, totalQuantity.toFixed(stockBook.getFractionDigits()))
                .from(unrealizedAccount)
                .to(contraAccount)
                .addRemoteId(remoteId)
                .setChecked(true)
            ;
            processor.setFinancialBookTransactionToCreate(mtmTx);
        } else if (amount.round(MAX_DECIMAL_PLACES).lt(0)) {
            const mtmTx = financialBook.newTransaction()
                .setDate(date)
                .setAmount(amount)
                .setDescription(`#mtm`)
                .setProperty(PRICE_PROP, financialBook.formatAmount(price))
                .setProperty(OPEN_QUANTITY_PROP, totalQuantity.toFixed(stockBook.getFractionDigits()))
                .from(contraAccount)
                .to(unrealizedAccount)
                .addRemoteId(remoteId)
                .setChecked(true)
            ;
            processor.setFinancialBookTransactionToCreate(mtmTx);
        }
    }

    function recordInterestAccountMtm(book: Bkper.Book, account: Bkper.Account, urAccount: Bkper.Account, amount: Bkper.Amount, date: string, remoteId: string, processor: CalculateRealizedResultsProcessor): void {
        if (amount.gt(0)) {
            const interestMtmTx = book.newTransaction()
                .setDate(date)
                .setAmount(amount)
                .setDescription(`#interest_mtm`)
                .from(account)
                .to(urAccount)
                .addRemoteId(`interestmtm_${remoteId}`)
                .setChecked(true)
            ;
            processor.setFinancialBookTransactionToCreate(interestMtmTx);
        } else if (amount.lt(0)) {
            const interestMtmTx = book.newTransaction()
                .setDate(date)
                .setAmount(amount.abs())
                .setDescription(`#interest_mtm`)
                .from(urAccount)
                .to(account)
                .addRemoteId(`interestmtm_${remoteId}`)
                .setChecked(true)
            ;
            processor.setFinancialBookTransactionToCreate(interestMtmTx);
        }
    }

    function getLastTransactionId(sales: Bkper.Transaction[], purchases: Bkper.Transaction[]): string | null {
        const transactions = [...sales.concat(purchases)].sort(BotService.compareToFIFO);
        if (transactions.length > 0) {
            const lastTransaction = transactions[transactions.length - 1];
            if (lastTransaction) {
                return lastTransaction.getId();
            }
        }
        return null;
    }

    function getAccountBalance(book: Bkper.Book, account: Bkper.Account | StockAccount, date: Date): Bkper.Amount {
        let balances = book.getBalancesReport(`account:"${account.getName()}" on:${book.formatDate(date)}`);
        let containers = balances.getBalancesContainers();
        if (containers == null || containers.length == 0) {
            return BkperApp.newAmount(0);
        }
        return containers[0].getCumulativeBalance();
    }

    function addFxResult(
        stockAccount: StockAccount,
        stockExcCode: string,
        baseBook: Bkper.Book,
        unrealizedFxAccount: Bkper.Account,
        transaction: Bkper.Transaction,
        gainBaseWithFx: Bkper.Amount,
        gainBaseNoFx: Bkper.Amount,
        summary: Summary,
        shouldRecordAsHistResult: boolean,
        processor: CalculateRealizedResultsProcessor
    ): void {

        const gainDate = transaction.getProperty(DATE_PROP) || transaction.getDate();

        if (!gainBaseWithFx) {
            console.log('Missing gain with FX');
            return;
        }
        if (!gainBaseNoFx) {
            console.log('Missing gain no FX');
            return;
        }

        // Realized FX account
        const realizedFxAccountName = getRealizedFxAccountName(baseBook, unrealizedFxAccount, stockExcCode, shouldRecordAsHistResult);
        const realizedFxAccount = getRealizedFxAccount(baseBook, realizedFxAccountName);

        const fxGain = gainBaseWithFx.minus(gainBaseNoFx);

        const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
        const remoteId = shouldRecordAsHistResult ? `fx_hist_${baseRemoteId}` : `fx_${baseRemoteId}`;

        if (fxGain.round(MAX_DECIMAL_PLACES).gt(0)) {

            const description = shouldRecordAsHistResult ? '#exchange_gain_hist' : '#exchange_gain';

            const fxTransaction = baseBook.newTransaction()
                .addRemoteId(remoteId)
                .setDate(gainDate)
                .setAmount(fxGain)
                .setDescription(description)
                .setProperty(EXC_AMOUNT_PROP, '0')
                .from(realizedFxAccount)
                .to(unrealizedFxAccount)
                .setChecked(true)
            ;

            // Store transaction to be created
            processor.setBaseBookTransactionToCreate(fxTransaction);

        } else if (fxGain.round(MAX_DECIMAL_PLACES).lt(0)) {

            const description = shouldRecordAsHistResult ? '#exchange_loss_hist' : '#exchange_loss';

            const fxTransaction = baseBook.newTransaction()
                .addRemoteId(remoteId)
                .setDate(gainDate)
                .setAmount(fxGain)
                .setDescription(description)
                .setProperty(EXC_AMOUNT_PROP, '0')
                .from(unrealizedFxAccount)
                .to(realizedFxAccount)
                .setChecked(true)
            ;

            // Store transaction to be created
            processor.setBaseBookTransactionToCreate(fxTransaction);

        }

    }

    function getUnrealizedAccount(financialBook: Bkper.Book, stockAccount: StockAccount | Bkper.Account): Bkper.Account {
        return BotService.getSupportAccount(financialBook, stockAccount, UNREALIZED_SUFFIX, BotService.getTypeByAccountSuffix(financialBook, UNREALIZED_SUFFIX));
    }

    function getUnrealizedHistAccount(financialBook: Bkper.Book, stockAccount: StockAccount): Bkper.Account {
        return BotService.getSupportAccount(financialBook, stockAccount, UNREALIZED_HIST_SUFFIX, BotService.getTypeByAccountSuffix(financialBook, UNREALIZED_HIST_SUFFIX));
    }

    function getUnrealizedFxBaseAccount(baseBook: Bkper.Book, stockAccount: StockAccount, excAggregateProp: string): Bkper.Account {
        if (excAggregateProp) {
            return BotService.getSupportAccount(baseBook, stockAccount, UNREALIZED_SUFFIX, BotService.getTypeByAccountSuffix(baseBook, UNREALIZED_SUFFIX));
        }
        return BotService.getSupportAccount(baseBook, stockAccount, UNREALIZED_EXC_SUFFIX, BotService.getTypeByAccountSuffix(baseBook, UNREALIZED_EXC_SUFFIX));
    }

    function getUnrealizedFxHistBaseAccount(baseBook: Bkper.Book, stockAccount: StockAccount, excAggregateProp: string): Bkper.Account {
        if (excAggregateProp) {
            return BotService.getSupportAccount(baseBook, stockAccount, UNREALIZED_HIST_SUFFIX, BotService.getTypeByAccountSuffix(baseBook, UNREALIZED_HIST_SUFFIX));
        }
        return BotService.getSupportAccount(baseBook, stockAccount, UNREALIZED_HIST_EXC_SUFFIX, BotService.getTypeByAccountSuffix(baseBook, UNREALIZED_HIST_EXC_SUFFIX));
    }

    function getRealizedAccount(financialBook: Bkper.Book, stockAccount: StockAccount, historical: boolean): Bkper.Account {
        const suffix = historical ? REALIZED_HIST_SUFFIX : REALIZED_SUFFIX;
        return BotService.getSupportAccount(financialBook, stockAccount, suffix, BkperApp.AccountType.INCOMING);
    }

    function getRealizedFxAccountName(baseBook: Bkper.Book, unrealizedFxAccount: Bkper.Account, stockExcCode: string, historical: boolean): string {
        let excAccountProp = unrealizedFxAccount.getProperty(EXC_ACCOUNT_PROP);
        if (excAccountProp) {
            return excAccountProp;
        }
        const groups = unrealizedFxAccount.getGroups();
        if (groups) {
            for (const group of groups) {
                excAccountProp = group.getProperty(EXC_ACCOUNT_PROP);
                if (excAccountProp) {
                    return excAccountProp;
                }
            }
        }
        const excAggregateProp = baseBook.getProperty(EXC_AGGREGATE_PROP);
        if (excAggregateProp) {
            return historical ? `Exchange_${stockExcCode} Hist` : `Exchange_${stockExcCode}`;
        }
        return `${unrealizedFxAccount.getName().replace(UNREALIZED_SUFFIX, REALIZED_SUFFIX)}`;
    }

    function getRealizedFxAccount(baseBook: Bkper.Book, realizedFxAccountName: string): Bkper.Account {
        let account = baseBook.getAccount(realizedFxAccountName);
        if (!account) {
            account = baseBook.newAccount().setName(realizedFxAccountName);
            const groups = getRealizedFxAccountGroups(baseBook, realizedFxAccountName);
            groups.forEach(group => account.addGroup(group));
            account.setType(BotService.getRealizedExcAccountType(baseBook));
            account.create();
        }
        return account;
    }

    function getRealizedFxAccountGroups(baseBook: Bkper.Book, realizedFxAccountName: string): Set<Bkper.Group> {
        if (realizedFxAccountName.startsWith('Exchange_')) {
            // Exchange_XXX Hist
            if (realizedFxAccountName.endsWith(' Hist')) {
                return getExcAccountGroups(baseBook, true);
            }
            // Exchange_XXX
            return getExcAccountGroups(baseBook, false);
        } else if (realizedFxAccountName.endsWith(` ${REALIZED_EXC_SUFFIX}`)) {
            // XXX Realized EXC
            return BotService.getGroupsByAccountSuffix(baseBook, REALIZED_EXC_SUFFIX);
        } else if (realizedFxAccountName.endsWith(` ${REALIZED_HIST_EXC_SUFFIX}`)) {
            // XXX Realized Hist EXC
            return BotService.getGroupsByAccountSuffix(baseBook, REALIZED_HIST_EXC_SUFFIX);
        }
        return new Set<Bkper.Group>();
    }

    function getExcAccountGroups(baseBook: Bkper.Book, historical: boolean): Set<Bkper.Group> {
        let accountNames = new Set<string>();
        baseBook.getAccounts().forEach(account => {
            const accountName = account.getName();
            if (historical) {
                if (accountName.startsWith('Exchange_') && accountName.endsWith(' Hist')) {
                    accountNames.add(accountName);
                }
            } else {
                if (accountName.startsWith('Exchange_')) {
                    accountNames.add(accountName);
                }
            }
        });
        let groups = new Set<Bkper.Group>();
        if (accountNames.size === 0) {
            return groups;
        }
        for (const group of baseBook.getGroups()) {
            const groupAccounts = group.getAccounts();
            if (groupAccounts && groupAccounts.length > 0) {
                let shouldAddGroup = true;
                for (const accountName of accountNames) {
                    const account = baseBook.getAccount(accountName);
                    if (!account) {
                        continue;
                    }
                    if (!account.isInGroup(group)) {
                        shouldAddGroup = false;
                        break;
                    }
                }
                if (shouldAddGroup) {
                    groups.add(group);
                }
            }
        }
        return groups;
    }

}
