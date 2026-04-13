namespace CostOfSalesService {

    export function calculateCostOfSalesForAccount(inventoryBookId: string, goodAccountId: string, toDate?: string): Summary {
        const inventoryBook = BkperApp.getBook(inventoryBookId);
        if (!toDate) {
            toDate = inventoryBook.formatDate(new Date());
        }

        let goodAccount = new GoodAccount(inventoryBook.getAccount(goodAccountId));

        const summary = new Summary(goodAccountId);

        if (goodAccount.needsRebuild()) {
            // Fire reset async
            CostOfSalesService.resetCostOfSalesForAccount(inventoryBookId, goodAccountId);
            return summary.rebuild();
        }

        const goodExcCode = BotService.getExchangeCode(goodAccount.getAccount());
        const financialBook = BotService.getFinancialBook(inventoryBook, goodExcCode);

        // Skip
        if (financialBook == null) {
            return summary.setResult(`Cannot proceed: financial book not found for good account ${goodAccount.getName()}`);
        }

        const beforeDate = BotService.getBeforeDateIsoString(inventoryBook, toDate);
        const iterator = inventoryBook.getTransactions(helper.getAccountQuery(goodAccount.getName(), beforeDate));

        let goodAccountSaleTransactions: Bkper.Transaction[] = [];
        let goodAccountPurchaseTransactionsMap: Map<string, Bkper.Transaction> = new Map();
        let goodAccountCreditNoteTransactionsMap: Map<string, Bkper.Transaction> = new Map();

        let totalSalesQuantity = 0;
        let totalPurchasedQuantity = 0;

        while (iterator.hasNext()) {
            const tx = iterator.next();
            // Filter only unchecked
            if (tx.isChecked()) {
                continue;
            }
            if (BotService.isSale(tx)) {
                goodAccountSaleTransactions.push(tx);
                totalSalesQuantity += tx.getAmount().toNumber();
            }
            if (BotService.isPurchase(tx)) {
                goodAccountPurchaseTransactionsMap.set(tx.getProperty(PURCHASE_CODE_PROP), tx);
                totalPurchasedQuantity += tx.getAmount().toNumber();
            }
            if (BotService.isCreditNote(tx)) {
                goodAccountCreditNoteTransactionsMap.set(tx.getProperty(CREDIT_NOTE_PROP), tx);
                totalPurchasedQuantity -= tx.getAmount().toNumber();
            }
        }

        if (totalSalesQuantity == 0) {
            return summary;
        }
        // Total sales quantity cannot be greater than available quantity in inventory
        if (totalSalesQuantity > totalPurchasedQuantity) {
            return summary.salequantityError();
        }

        // Processor
        const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);

        // process credit notes before sales
        for (const [creditNote, creditNoteTx] of goodAccountCreditNoteTransactionsMap.entries()) {
            const purchaseCode = creditNoteTx.getProperty(PURCHASE_CODE_PROP);
            const purchaseTransaction = goodAccountPurchaseTransactionsMap.get(purchaseCode);
            if (purchaseTransaction) {
                const creditNoteQuantity = BkperApp.newAmount(creditNoteTx.getAmount().toNumber());
                const remainingQuantity = purchaseTransaction.getAmount().minus(creditNoteQuantity);

                if (remainingQuantity.toNumber() <= 0) {
                    return summary.creditNoteQuantityError(creditNoteTx.getProperty(CREDIT_NOTE_PROP));
                } else {
                    // split purchase transaction
                    let splittedPurchaseTransaction = inventoryBook.newTransaction()
                        .setDate(purchaseTransaction.getDate())
                        .setAmount(creditNoteQuantity)
                        .setCreditAccount(purchaseTransaction.getCreditAccount())
                        .setDebitAccount(purchaseTransaction.getDebitAccount())
                        .setDescription(purchaseTransaction.getDescription())
                        .setProperty(PARENT_ID, purchaseTransaction.getId())
                        .setProperty(PURCHASE_CODE_PROP, purchaseCode.toString())
                        .setProperty(CREDIT_NOTE_PROP, creditNote)
                        .addRemoteId(creditNote)
                        .setChecked(true)
                        ;

                    // Store transaction to be created
                    processor.setInventoryBookTransactionToCreate(splittedPurchaseTransaction);

                    // update purchase transaction
                    purchaseTransaction.setAmount(remainingQuantity);
                    processor.setInventoryBookTransactionToUpdate(purchaseTransaction);
                    goodAccountPurchaseTransactionsMap.set(purchaseCode, purchaseTransaction);

                    // check credit note transaction
                    creditNoteTx.setChecked(true);
                    processor.setInventoryBookTransactionToUpdate(creditNoteTx);
                }
            }
        }

        goodAccountSaleTransactions = goodAccountSaleTransactions.sort(BotService.compareToFIFO);
        const goodAccountPurchaseTransactions = Array.from(goodAccountPurchaseTransactionsMap.values()).sort(BotService.compareToFIFO);

        // Process sales
        for (const saleTransaction of goodAccountSaleTransactions) {
            if (goodAccountSaleTransactions.length > 0) {
                processSale(financialBook, inventoryBook, saleTransaction, goodAccountPurchaseTransactions, processor);
            }
            // Abort if any transaction is locked
            if (processor.hasLockedTransaction()) {
                return summary.lockError();
            }
        }

        // Fire batch operations
        processor.fireBatchOperations();

        storeLastCalcTxDate(goodAccount, goodAccountSaleTransactions);

        return summary.calculatingAsync();
    }

    function storeLastCalcTxDate(goodAccount: GoodAccount, goodAccountSaleTransactions: Bkper.Transaction[]) {
        let lastSaleTx = goodAccountSaleTransactions.length > 0 ? goodAccountSaleTransactions[goodAccountSaleTransactions.length - 1] : null;

        let lastTxDateValue = lastSaleTx != null ? lastSaleTx.getDateValue() : null;
        let lastTxDate = lastSaleTx != null ? lastSaleTx.getDate() : null;

        let goodAccountLastTxDateValue = goodAccount.getCOGSCalculationDateValue();
        if (lastTxDateValue != null && (goodAccountLastTxDateValue == null || lastTxDateValue > goodAccountLastTxDateValue)) {
            goodAccount.setCOGSCalculationDate(lastTxDate || '').update();
        }
    }

    function processSale(financialBook: Bkper.Book, inventoryBook: Bkper.Book, saleTransaction: Bkper.Transaction, purchaseTransactions: Bkper.Transaction[], processor: CalculateCostOfSalesProcessor): void {

        // Log operation status
        console.log(`processing sale: ${saleTransaction.getId()} - ${saleTransaction.getDescription()}`);

        // Sale info: quantity, prices, exchange rates
        let soldQuantity = saleTransaction.getAmount();

        let saleCost = BkperApp.newAmount(0);
        let purchaseLogEntries: PurchaseLogEntry[] = [];

        for (const purchaseTransaction of purchaseTransactions) {

            if (purchaseTransaction.isChecked()) {
                // Only process unchecked purchases
                continue;
            }

            // Log operation status
            console.log(`processing purchase: ${purchaseTransaction.getId()} - ${purchaseTransaction.getDescription()}`);

            // Original purchase info: quantity and price
            const purchaseCode = purchaseTransaction.getProperty(PURCHASE_CODE_PROP);
            const originalQuantity = BkperApp.newAmount(purchaseTransaction.getProperty(ORIGINAL_QUANTITY_PROP));
            const transactionQuantity = purchaseTransaction.getAmount();
            const transactionCost = BkperApp.newAmount(purchaseTransaction.getProperty(TOTAL_COST_PROP));

            const creditNotesQuantity = originalQuantity.minus(transactionQuantity).toNumber();
            let additionalCosts = BkperApp.newAmount(0);
            let creditNotesAmount = BkperApp.newAmount(0);
            if (purchaseTransaction.getProperty(CREDIT_NOTE_PROP) == undefined && purchaseTransaction.getProperty(ADD_COSTS_PROP) == undefined) {
                // transaction hasn't been previously processed in FIFO execution. Get additional costs & credit notes to update purchase transaction
                ({ additionalCosts, creditNotesAmount } = getAdditionalCostsAndCreditNotes(financialBook, purchaseTransaction));
            }

            // Updated purchase costs
            let updatedCost = transactionCost.plus(additionalCosts).minus(creditNotesAmount);

            const costOfSalePerUnit = updatedCost.div(transactionQuantity);

            // Sold quantity is greater than or equal to purchase quantity
            if (soldQuantity.gte(transactionQuantity)) {

                // compute COGS
                saleCost = saleCost.plus(updatedCost);

                // update & check purchase transaction
                const liquidationLog = getLiquidationLog(saleTransaction, costOfSalePerUnit);
                purchaseTransaction
                    .setProperty(TOTAL_COST_PROP, updatedCost.toString())
                    .setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(liquidationLog))
                    .setProperty(ADD_COSTS_PROP, additionalCosts.toString())
                    .setProperty(CREDIT_NOTE_PROP, JSON.stringify({ quantity: creditNotesQuantity, amount: creditNotesAmount.toNumber() }))
                    .setChecked(true)
                    ;

                // Store transaction to be updated
                processor.setInventoryBookTransactionToUpdate(purchaseTransaction);

                // store purchase log entry
                purchaseLogEntries.push(getPurchaseLog(transactionQuantity, costOfSalePerUnit, purchaseTransaction));

                // update sold quantity
                soldQuantity = soldQuantity.minus(transactionQuantity);

            } else {
                // Sold quantity is less than purchase quantity: split and update purchase transaction
                const remainingQuantity = transactionQuantity.minus(soldQuantity);
                const partialBuyQuantity = transactionQuantity.minus(remainingQuantity);
                const splittedCost = partialBuyQuantity.times(costOfSalePerUnit)
                const remainingCost = updatedCost.minus(splittedCost)

                // compute COGS
                saleCost = saleCost.plus(splittedCost);

                // update purchase transaction
                purchaseTransaction
                    .setAmount(remainingQuantity)
                    .setProperty(TOTAL_COST_PROP, remainingCost.toString())
                    .setProperty(ADD_COSTS_PROP, additionalCosts.toString())
                    .setProperty(CREDIT_NOTE_PROP, JSON.stringify({ quantity: creditNotesQuantity, amount: creditNotesAmount.toNumber() }))
                    ;

                    purchaseTransaction.setProperty(ADD_COSTS_PROP, additionalCosts.toString());

                    purchaseTransaction.setProperty(CREDIT_NOTE_PROP, JSON.stringify({ quantity: creditNotesQuantity, amount: creditNotesAmount.toNumber() }));

                // Store transaction to be updated
                processor.setInventoryBookTransactionToUpdate(purchaseTransaction);

                // create splitted purchase transaction
                const liquidationLog = getLiquidationLog(saleTransaction, costOfSalePerUnit);
                let splittedPurchaseTransaction = inventoryBook.newTransaction()
                    .setDate(purchaseTransaction.getDate())
                    .setAmount(partialBuyQuantity)
                    .setCreditAccount(purchaseTransaction.getCreditAccount())
                    .setDebitAccount(purchaseTransaction.getDebitAccount())
                    .setDescription(purchaseTransaction.getDescription())
                    .setProperty(EXC_CODE_PROP, purchaseTransaction.getProperty(EXC_CODE_PROP))
                    .setProperty(PARENT_ID, purchaseTransaction.getId())
                    .setProperty(PURCHASE_CODE_PROP, purchaseCode.toString())
                    .setProperty(TOTAL_COST_PROP, splittedCost.toString())
                    .setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(liquidationLog))
                    .setProperty(ORDER_PROP, purchaseTransaction.getProperty(ORDER_PROP))
                    .addRemoteId(processor.generateId())
                    .setChecked(true)
                    ;

                // Store transaction to be created
                processor.setInventoryBookTransactionToCreate(splittedPurchaseTransaction);

                // store purchase log entry
                purchaseLogEntries.push(getPurchaseLog(partialBuyQuantity, costOfSalePerUnit, purchaseTransaction));

                // update sold quantity
                soldQuantity = soldQuantity.minus(partialBuyQuantity);
            }
            // Break loop if sale is fully processed, otherwise proceed to next purchase
            if (soldQuantity.eq(0)) {
                break;
            }
        }

        // Sold quantity EQ zero: update & check sale transaction
        if (soldQuantity.round(inventoryBook.getFractionDigits()).eq(0)) {
            if (purchaseLogEntries.length > 0) {
                saleTransaction
                    .setProperty(TOTAL_COST_PROP, saleCost.toString())
                    .setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries))
                    .setChecked(true)
                    ;
            }

            // Store transaction to be updated
            processor.setInventoryBookTransactionToUpdate(saleTransaction);
        }

        // post cost of sale transaction in financial book
        addCostOfSales(financialBook, saleTransaction, saleCost, processor);
    }

    function addCostOfSales(financialBook: Bkper.Book, saleTransaction: Bkper.Transaction, saleCost: Bkper.Amount, processor: CalculateCostOfSalesProcessor) {
        let costOfSalesAccount = financialBook.getAccount(COGS_ACCOUNT);
        if (!costOfSalesAccount) {
            costOfSalesAccount = financialBook.newAccount()
                .setName(COGS_ACCOUNT)
                .setType(BkperApp.AccountType.OUTGOING)
                .create();
        }

        let financialGoodAccount: Bkper.Account = financialBook.getAccount(saleTransaction.getCreditAccountName());
        const remoteId = saleTransaction.getId();
        const description = `#COGS ${saleTransaction.getDescription()}`;

        // link COGS transaction in fanancial book to sale transaction in inventory book
        const costOfSaleTransaction = financialBook.newTransaction()
            .addRemoteId(remoteId)
            .setDate(saleTransaction.getDate())
            .setAmount(saleCost)
            .setDescription(description)
            .from(financialGoodAccount)
            .to(costOfSalesAccount)
            .setProperty(QUANTITY_SOLD_PROP, `${saleTransaction.getAmount().toNumber()}`)
            .setProperty(SALE_INVOICE_PROP, `${saleTransaction.getProperty(SALE_INVOICE_PROP)}`)
            .setChecked(true)
            ;

        // Store transaction to be created
        processor.setFinancialBookTransactionToCreate(costOfSaleTransaction);
    }

    /**
     * Searches for and calculates additional costs and credit notes linked to a purchase transaction
     * within a specified time range. Additional costs are identified by matching purchase codes and
     * having different purchase invoice numbers. Credit notes are identified by matching purchase 
     * codes and having credit note properties.
     * 
     * @param financialBookbook Book containing the financial transactions and costs
     * @param inventoryBook Book containing the inventory quantity records
     * @param inventoryTransaction The purchase transaction to analyze
     * @returns Combined totals of additional costs and credit note amounts found
     */
    export function getAdditionalCostsAndCreditNotes(financialBookbook: Bkper.Book, inventoryTransaction: Bkper.Transaction): { additionalCosts: Bkper.Amount, creditNotesAmount: Bkper.Amount } {
        // Calculate date range for searching related transactions
        const transactionDate = helper.parseDate(inventoryTransaction.getDate());
        const timeRange = helper.getTimeRange(ADDITIONAL_COSTS_CREDITS_QUERY_RANGE);

        // Set upper bound of date range
        const beforeDate = new Date(transactionDate.getTime() + timeRange);
        const beforeDateIsoString = Utilities.formatDate(beforeDate, financialBookbook.getTimeZone(), 'yyyy-MM-dd');

        // Set lower bound of date range
        const afterDate = new Date(transactionDate.getTime() - timeRange);
        const afterDateIsoString = Utilities.formatDate(afterDate, financialBookbook.getTimeZone(), 'yyyy-MM-dd');

        // Build query to get transactions for the inventory account within date range
        const inventoryAccountName = inventoryTransaction.getDebitAccount().getName();
        const query = helper.getAccountQuery(inventoryAccountName, beforeDateIsoString, afterDateIsoString);

        // Get purchase code and account info for matching
        const purchaseCode = inventoryTransaction.getProperty(PURCHASE_CODE_PROP);
        const transactions = financialBookbook.getTransactions(query);
        const financialAccountId = financialBookbook.getAccount(inventoryAccountName).getId();

        // Initialize running totals
        let totalAdditionalCosts = BkperApp.newAmount(0);
        let totalCreditAmount = BkperApp.newAmount(0);

        // Process each transaction in the date range
        while (transactions.hasNext()) {
            const tx = transactions.next();

            // Check for additional costs:
            // - Transaction must be checked
            // - Must debit the same account
            // - Must have matching purchase code
            // - Must have different purchase invoice number
            if (tx.isChecked() &&
                tx.getDebitAccount().getId() == financialAccountId &&
                tx.getProperty(PURCHASE_CODE_PROP) == purchaseCode &&
                (tx.getProperty(PURCHASE_INVOICE_PROP) != undefined &&
                    tx.getProperty(PURCHASE_INVOICE_PROP) != purchaseCode)) {
                totalAdditionalCosts = totalAdditionalCosts.plus(tx.getAmount());
            }
            // Check for credit notes:
            // - Transaction must be checked
            // - Must have credit note property
            // - Must have matching purchase code  
            // - Must credit the same account
            else if (tx.isChecked() &&
                tx.getProperty(CREDIT_NOTE_PROP) != undefined &&
                tx.getProperty(PURCHASE_CODE_PROP) == purchaseCode &&
                tx.getCreditAccount().getId() == financialAccountId) {
                totalCreditAmount = totalCreditAmount.plus(tx.getAmount());
            }
        }

        // Return the calculated totals
        return {
            additionalCosts: totalAdditionalCosts,
            creditNotesAmount: totalCreditAmount
        };
    }

    function getLiquidationLog(transaction: Bkper.Transaction, costOfSalePerUnit: Bkper.Amount, excRate?: Bkper.Amount): LiquidationLogEntry {
        return {
            id: transaction.getId(),
            dt: transaction.getDate(),
            qt: transaction.getAmount().toString(),
            uc: costOfSalePerUnit.toString(),
            rt: excRate?.toString() || ''
        }
    }

    function getPurchaseLog(quantity: Bkper.Amount, costOfSalePerUnit: Bkper.Amount, transaction: Bkper.Transaction, excRate?: Bkper.Amount): PurchaseLogEntry {
        return {
            id: transaction.getId(),
            qt: quantity.toString(),
            uc: costOfSalePerUnit.toString(),
            rt: excRate?.toString() || ''
        }
    }
}