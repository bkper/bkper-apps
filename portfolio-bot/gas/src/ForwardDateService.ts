namespace ForwardDateService {

    export function forwardDate(stockBookId: string, stockAccountId: string, date: string): Summary {

        const stockBook = BkperApp.getBook(stockBookId);
        const stockAccount = new StockAccount(stockBook.getAccount(stockAccountId));

        // New forward date
        const dateValue = +(date.replaceAll('-', ''));

        // Current realized date
        const realizedDateValue = stockAccount.getRealizedDateValue();
        // Current forwarded date
        const forwardedDateValue = stockAccount.getForwardedDateValue();

        // Summary
        const summary = new Summary(stockAccountId);

        // Do NOT allow forward if account has uncalculated results
        if (BotService.isAccountUncalculated(stockBookId, stockAccountId, date)) {
            const errorMsg = 'Cannot set forward date: account has uncalculated results';
            return summary.forwardError(errorMsg);
        }

        // Do NOT allow forward if new date is equal the current forwarded date
        if (forwardedDateValue && dateValue === forwardedDateValue) {
            const errorMsg = `Cannot set forward date: account forwarded date is already ${BotService.formatDate(stockAccount.getForwardedDate(), stockBook.getTimeZone(), stockBook.getDatePattern())}`;
            return summary.forwardError(errorMsg);
        }

        // Forward fix: allow only if the conditions are met
        if (forwardedDateValue && dateValue < forwardedDateValue) {
            if (!isUserBookOwner(stockBook)) {
                const errorMsg = `Cannot lower forward date: user must be book owner`;
                return summary.forwardError(errorMsg);
            }
            if (!isCollectionUnlocked(stockBook)) {
                const errorMsg = `Cannot lower forward date: collection has locked/closed book(s)`;
                return summary.forwardError(errorMsg);
            }
            return fixAndForwardDateForAccount(stockBook, stockAccount, date);
        }

        // Do NOT allow forward if new date is equal or below the current realized date
        if (realizedDateValue && dateValue <= realizedDateValue) {
            const errorMsg = `Cannot set forward date: account has realized results up to ${BotService.formatDate(stockAccount.getRealizedDate(), stockBook.getTimeZone(), stockBook.getDatePattern())}`;
            return summary.forwardError(errorMsg);
        }

        // Regular forward
        return forwardDateForAccount(stockBook, stockAccount, date, false);

    }

    function fixAndForwardDateForAccount(stockBook: Bkper.Book, stockAccount: StockAccount, forwardDate: string): Summary {

        // Reset results up to current forwarded date - reset sync for now
        RealizedResultsService.resetRealizedResultsForAccountSync(stockBook, stockAccount, false);

        // Fix previous forward
        let iterator = stockBook.getTransactions(`account:'${stockAccount.getName()}' after:${stockAccount.getForwardedDate()}`);
        let forwardedTransactions: Bkper.Transaction[] = [];
        while (iterator.hasNext()) {
            const tx = iterator.next();
            if (tx.getProperty(FWD_LOG_PROP)) {
                forwardedTransactions.push(tx);
            }
        }
        for (const transaction of forwardedTransactions) {

            // Log operation status
            console.log(`processing transaction: ${transaction.getId()}`);

            // Get forwarded transaction previous state
            let previousStateTx = getForwardedTransactionPreviousState(stockBook, stockAccount, transaction, forwardDate);
            // Return forwarded transaction to previous state
            transaction
                .setDate(previousStateTx.getDate())
                .setVisibleProperties(previousStateTx.getProperties())
                .deleteProperty(FWD_TX_PROP)
                .deleteProperty(FWD_TX_REMOTE_IDS_PROP)
                .update()
            ;
            stockAccount.pushTrash(previousStateTx);
        }
        // Delete unnecessary transactions
        stockAccount.cleanTrash();

        // Reset results up to new forward date - reset sync for now
        const resetIterator = stockBook.getTransactions(`account:'${stockAccount.getName()}' after:${forwardDate}`);
        RealizedResultsService.resetRealizedResultsForAccountSync(stockBook, stockAccount, false, resetIterator);

        // Set new forward date
        const newForward = forwardDateForAccount(stockBook, stockAccount, forwardDate, true);

        const newForwardMsg = newForward.getResult().replaceAll(`"`, '').replace(`Done! `, '');
        const doneMsg = `Done! ${forwardedTransactions.length} fixed and ${newForwardMsg}`;
        return new Summary(stockAccount.getId()).done(doneMsg);
    }

    function forwardDateForAccount(stockBook: Bkper.Book, stockAccount: StockAccount, forwardDate: string, fixingForward: boolean): Summary {

        // Do not allow forward if account needs rebuild
        if (stockAccount.needsRebuild()) {
            const errorMsg = 'Cannot set forward date: account needs rebuild';
            return new Summary(stockAccount.getId()).forwardError(errorMsg);
        }

        const baseBook = BotService.getBaseBook(stockBook);
        const baseExcCode = BotService.getExcCode(baseBook);

        const stockExcCode = stockAccount.getExchangeCode();
        const financialBook = BotService.getFinancialBook(stockBook, stockExcCode);

        // Closing Date: Forward Date - 1 day
        const closingDate = new Date();
        closingDate.setTime(stockBook.parseDate(forwardDate).getTime());
        closingDate.setDate(closingDate.getDate() - 1);
        // Closing Date ISO
        const closingDateISO = Utilities.formatDate(closingDate, stockBook.getTimeZone(), "yyyy-MM-dd");

        let stockBookBalancesReport = stockBook.getBalancesReport(`account:'${stockAccount.getName()}' on:${stockBook.formatDate(closingDate)}`);
        let baseBookBalancesReport = baseBook.getBalancesReport(`account:'${stockAccount.getName()}' on:${baseBook.formatDate(closingDate)}`);
        let financialBookBalancesReport = financialBook.getBalancesReport(`account:'${stockAccount.getName()}' on:${financialBook.formatDate(closingDate)}`);

        let needToRecordLiquidationTx = true;

        // Open amount from Base Book
        const openAmountBase = baseBookBalancesReport.getBalancesContainer(stockAccount.getName()).getCumulativeBalanceRaw();
        // Open amount from Local Book
        const openAmountLocal = financialBookBalancesReport.getBalancesContainer(stockAccount.getName()).getCumulativeBalanceRaw();
        // Open quantity from Stock Book
        let openQuantity = stockBookBalancesReport.getBalancesContainer(stockAccount.getName()).getCumulativeBalanceRaw();
        if (openQuantity.eq(0) && fixingForward) {
            openQuantity = tryOpenQuantityFromLiquidationTx(stockBook, stockAccount, closingDateISO);
            if (!openQuantity.eq(0)) {
                needToRecordLiquidationTx = false;
            }
        }
        // Current price
        const fwdPrice = !openQuantity.eq(0) ? openAmountLocal.div(openQuantity) : undefined;
        // Current exchange rate
        const fwdExcRate = !openAmountLocal.eq(0) ? openAmountBase.div(openAmountLocal) : undefined;

        let iterator = stockBook.getTransactions(`account:'${stockAccount.getName()}' before:${forwardDate}`);
        let transactions: Bkper.Transaction[] = [];

        while (iterator.hasNext()) {
            const tx = iterator.next();
            if (!tx.isChecked()) {
                transactions.push(tx);
            }
        }

        transactions = transactions.sort(BotService.compareToFIFO);

        let logTransactionsIds: string[] = [];
        let transactionsToCheck: Bkper.Transaction[] = [];
        let order = -transactions.length;

        for (const transaction of transactions) {

            // Log operation status
            console.log(`processing transaction: ${transaction.getId()}`);

            // Post copy of transaction in order to keep a forward history
            let logTransaction = buildLogTransaction(stockBook, transaction).post();

            // Forward transaction
            forwardTransaction(transaction, logTransaction, stockExcCode, baseExcCode, fwdPrice, fwdExcRate, forwardDate, order);

            logTransactionsIds.push(logTransaction.getId());
            transactionsToCheck.push(logTransaction);
            order++;
        }

        // Record new transaction liquidating the logs
        let liquidationTxId = '';
        if (needToRecordLiquidationTx && !openQuantity.eq(0)) {
            let liquidationTransaction = buildLiquidationTransaction(stockBook, stockAccount, openQuantity, closingDate, forwardDate);
            liquidationTransaction
                .setProperty(FWD_LIQUIDATION_PROP, JSON.stringify(logTransactionsIds))
                .post()
            ;
            liquidationTxId = liquidationTransaction.getId();
            transactionsToCheck.push(liquidationTransaction);
        }

        // Check logs and liquidation transaction
        stockBook.batchCheckTransactions(transactionsToCheck);

        const urFinancialBookBalancesReport = financialBook.getBalancesReport(`account:'${stockAccount.getName()} ${UNREALIZED_SUFFIX}' after:${stockAccount.getForwardedDate()} before:${forwardDate}`);
        const urBaseBookBalancesReport = baseBook.getBalancesReport(`account:'${stockAccount.getName()} ${UNREALIZED_SUFFIX}' after:${stockAccount.getForwardedDate()} before:${forwardDate}`);

        // Unrealized account balances
        const urBalanceLocal = getAccountBalance(urFinancialBookBalancesReport, `${stockAccount.getName()} ${UNREALIZED_SUFFIX}`);
        const urBalanceBase = getAccountBalance(urBaseBookBalancesReport, `${stockAccount.getName()} ${UNREALIZED_SUFFIX}`);

        // Record "Forwarded Results" (Unrealized account gap) - DO NOT RECORD IF BOOK IS HISTORICAL
        const model = BotService.getCalculationModel(stockBook);
        if (model !== CalculationModel.HISTORICAL_ONLY && liquidationTxId && !urBalanceLocal.eq(0)) {
            const forwardedResultTransaction = buildForwardedResultTransaction(financialBook, baseBook, stockAccount, closingDate, urBalanceLocal, urBalanceBase);
            forwardedResultTransaction
                .addRemoteId(`fwd_${liquidationTxId}`)
                .setChecked(true)
                .create()
            ;
        }

        // Update stock account
        updateStockAccount(stockAccount, stockExcCode, baseExcCode, fwdPrice, fwdExcRate, forwardDate);

        if (isForwardedDateSameOnAllAccounts(stockBook, forwardDate) && stockBook.getClosingDate() != closingDateISO) {
            // Prevent book from closing before last transaction check
            Utilities.sleep(5000);
            stockBook.setClosingDate(closingDateISO).update();
            const doneMsg = `Done! ${transactions.length} forwarded to ${BotService.formatDate(forwardDate, stockBook.getTimeZone(), stockBook.getDatePattern())} and book closed on ${stockBook.formatDate(closingDate)}`;
            return new Summary(stockAccount.getId()).done(doneMsg);
        } else {
            const doneMsg = `Done! ${transactions.length} forwarded to ${BotService.formatDate(forwardDate, stockBook.getTimeZone(), stockBook.getDatePattern())}`;
            return new Summary(stockAccount.getId()).done(doneMsg);
        }

    }

    function forwardTransaction(transaction: Bkper.Transaction, logTransaction: Bkper.Transaction, stockExcCode: string, baseExcCode: string, fwdPrice: Bkper.Amount, fwdExcRate: Bkper.Amount, forwardDate: string, order: number): void {
        if (!transaction.getProperty(DATE_PROP)) {
            transaction.setProperty(DATE_PROP, transaction.getDate());
        }
        if (!transaction.getProperty(HIST_QUANTITY_PROP)) {
            transaction.setProperty(HIST_QUANTITY_PROP, transaction.getProperty(ORIGINAL_QUANTITY_PROP));
        }
        if (!transaction.getProperty(HIST_ORDER_PROP)) {
            transaction.setProperty(HIST_ORDER_PROP, transaction.getProperty(ORDER_PROP));
        }
        if (BotService.isPurchase(transaction)) {
            transaction.setProperty(FWD_PURCHASE_PRICE_PROP, fwdPrice ? fwdPrice.toString() : undefined);
            if (stockExcCode !== baseExcCode) {
                transaction.setProperty(FWD_PURCHASE_EXC_RATE_PROP, fwdExcRate ? fwdExcRate.toString() : undefined);
            }
        }
        if (BotService.isSale(transaction)) {
            transaction.setProperty(FWD_SALE_PRICE_PROP, fwdPrice ? fwdPrice.toString() : undefined);
            if (stockExcCode !== baseExcCode) {
                transaction.setProperty(FWD_SALE_EXC_RATE_PROP, fwdExcRate ? fwdExcRate.toString() : undefined);
            }
        }
        transaction
            .deleteProperty(ORIGINAL_AMOUNT_PROP)
            .setProperty(ORIGINAL_QUANTITY_PROP, transaction.getAmount().toString())
            .setProperty(ORDER_PROP, order + '')
            .setProperty(FWD_LOG_PROP, logTransaction.getId())
            .setDate(forwardDate)
            .update()
        ;
    }

    function updateStockAccount(stockAccount: StockAccount, stockExcCode: string, baseExcCode: string, fwdPrice: Bkper.Amount, fwdExcRate: Bkper.Amount, forwardDate: string): void {
        stockAccount
            .setRealizedDate(forwardDate)
            .setForwardedDate(forwardDate)
            .setForwardedPrice(fwdPrice)
        ;
        if (stockExcCode !== baseExcCode) {
            stockAccount.setForwardedExcRate(fwdExcRate);
        }
        stockAccount.update();
    }

    function isForwardedDateSameOnAllAccounts(stockBook: Bkper.Book, forwardedDate: string): boolean {
        for (const account of stockBook.getAccounts()) {
            const stockAccount = new StockAccount(account)
            if (stockAccount.isPermanent() && !stockAccount.isArchived() && stockAccount.getExchangeCode()) {
                if (stockAccount.getForwardedDate() != forwardedDate) {
                    return false
                }
            }
        }
        return true;
    }

    function buildLogTransaction(stockBook: Bkper.Book, transaction: Bkper.Transaction): Bkper.Transaction {
        const remoteIds: string[] = transaction.getRemoteIds() || [];
        return stockBook.newTransaction()
            .setAmount(transaction.getAmount())
            .from(transaction.getCreditAccount())
            .to(transaction.getDebitAccount())
            .setDate(transaction.getDate())
            .setDescription(transaction.getDescription())
            .setVisibleProperties(transaction.getProperties())
            .setProperty(FWD_TX_PROP, transaction.getId())
            .setProperty(FWD_TX_REMOTE_IDS_PROP, JSON.stringify(remoteIds))
        ;
    }

    function buildLiquidationTransaction(stockBook: Bkper.Book, stockAccount: StockAccount, quantity: Bkper.Amount, closingDate: Date, forwardDate: string): Bkper.Transaction {
        const fromAccount = quantity.lt(0) ? stockAccount.getAccount() : BotService.getBuyAccount(stockBook);
        const toAccount = quantity.lt(0) ? BotService.getSellAccount(stockBook) : stockAccount.getAccount();
        return stockBook.newTransaction()
            .setAmount(quantity.abs())
            .from(fromAccount)
            .to(toAccount)
            .setDate(closingDate)
            .setDescription(`${quantity.times(-1)} units forwarded to ${forwardDate}`)
        ;
    }

    function isUserBookOwner(stockBook: Bkper.Book): boolean {
        return stockBook.getPermission() == BkperApp.Permission.OWNER;
    }

    function isCollectionUnlocked(stockBook: Bkper.Book): boolean {
        const books = stockBook.getCollection().getBooks();
        for (const book of books) {
            let lockDate = book.getLockDate();
            if (lockDate && lockDate !== '1900-00-00') {
                return false;
            }
            let closingDate = book.getClosingDate();
            if (closingDate && closingDate !== '1900-00-00') {
                return false;
            }
        }
        return true;
    }

    function getForwardedTransactionPreviousState(stockBook: Bkper.Book, stockAccount: StockAccount, transaction: Bkper.Transaction, forwardDate: string): Bkper.Transaction {
        const previousStateId = transaction.getProperty(FWD_LOG_PROP);
        if (!previousStateId) {
            return transaction;
        }
        const previousStateTx = stockBook.getTransaction(previousStateId);
        if (!previousStateTx) {
            return transaction;
        }
        if (previousStateTx.getDateValue() <= +(forwardDate.replaceAll('-', ''))) {
            return previousStateTx;
        }
        stockAccount.pushTrash(previousStateTx);
        return getForwardedTransactionPreviousState(stockBook, stockAccount, previousStateTx, forwardDate);
    }

    function tryOpenQuantityFromLiquidationTx(stockBook: Bkper.Book, stockAccount: StockAccount, closingDate: string): Bkper.Amount {
        const iterator = stockBook.getTransactions(`account:'${stockAccount.getName()}' on:${closingDate}`);
        while (iterator.hasNext()) {
            const tx = iterator.next();
            if (tx.getProperty(FWD_LIQUIDATION_PROP)) {
                if (BotService.isPurchase(tx)) {
                    return tx.getAmount();
                }
                if (BotService.isSale(tx)) {
                    return tx.getAmount().times(-1);
                }
            }
        }
        return BkperApp.newAmount(0);
    }

    function getAccountBalance(report: Bkper.BalancesReport, accountName: string): Bkper.Amount {
        let balance = BkperApp.newAmount(0);
        try {
            balance = report.getBalancesContainer(accountName).getCumulativeBalance();
        } catch (error) {
            // console.log(error);
        }
        return balance;
    }

    function buildForwardedResultTransaction(financialBook: Bkper.Book, baseBook: Bkper.Book, stockAccount: StockAccount, closingDate: Date, localAmount: Bkper.Amount, baseAmount: Bkper.Amount): Bkper.Transaction {

        const isBaseBook = baseBook.getId() === financialBook.getId();

        // Accounts
        const unrealizedAccount = BotService.getSupportAccount(financialBook, stockAccount, UNREALIZED_SUFFIX, BotService.getTypeByAccountSuffix(financialBook, UNREALIZED_SUFFIX));
        const forwardedAccount = BotService.getSupportAccount(financialBook, stockAccount, FORWARDED_SUFFIX, BkperApp.AccountType.LIABILITY);
        const fromAccount = localAmount.gt(0) ? forwardedAccount : unrealizedAccount;
        const toAccount = localAmount.gt(0) ? unrealizedAccount : forwardedAccount;

        const description = localAmount.gt(0) ? '#stock_gain_fwd' : '#stock_loss_fwd';

        return financialBook.newTransaction()
            .from(fromAccount)
            .to(toAccount)
            .setAmount(localAmount.abs())
            .setDate(closingDate)
            .setDescription(description)
            .setProperty(EXC_AMOUNT_PROP, getForwardedResultTransactionExcAmountProp(financialBook, isBaseBook, baseAmount))
            .setProperty(EXC_CODE_PROP, getForwardedResultTransactionExcCodeProp(financialBook, isBaseBook, baseBook))
        ;
    }

    function getForwardedResultTransactionExcAmountProp(financialBook: Bkper.Book, isBaseBook: boolean, baseAmount: Bkper.Amount): string | null {
        if (!BotService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : baseAmount.abs().toString();
    }

    function getForwardedResultTransactionExcCodeProp(financialBook: Bkper.Book, isBaseBook: boolean, baseBook: Bkper.Book): string | null {
        if (!BotService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : BotService.getExcCode(baseBook);
    }

}
