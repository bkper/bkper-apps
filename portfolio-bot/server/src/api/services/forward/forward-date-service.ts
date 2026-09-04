import {
    AccountType,
    Amount,
    Permission,
    Transaction,
    type BalancesReport,
    type Book,
} from 'bkper-js';
import {
    DATE_PROP,
    EXC_AMOUNT_PROP,
    EXC_CODE_PROP,
    FORWARDED_SUFFIX,
    FWD_LIQUIDATION_PROP,
    FWD_LOG_PROP,
    FWD_PURCHASE_EXC_RATE_PROP,
    FWD_PURCHASE_PRICE_PROP,
    FWD_SALE_EXC_RATE_PROP,
    FWD_SALE_PRICE_PROP,
    FWD_TX_PROP,
    FWD_TX_REMOTE_IDS_PROP,
    HIST_ORDER_PROP,
    HIST_QUANTITY_PROP,
    ORDER_PROP,
    ORIGINAL_AMOUNT_PROP,
    ORIGINAL_QUANTITY_PROP,
    UNREALIZED_SUFFIX,
} from '../../../shared/constants.js';
import { optionalLookup } from '../../../shared/optional-lookup.js';
import { BotService } from '../bot-service.js';
import type { OperationContext } from '../operation-service.js';
import { ResetRealizedResultsService } from '../reset/reset-realized-results-service.js';
import { StockAccount } from '../stock-account.js';
import { Summary } from '../summary.js';
import { CalculationModel } from '../calculate/types.js';

export class ForwardDateService {
    private readonly botService = new BotService();

    async execute(context: OperationContext, date: string): Promise<Summary> {
        const stockBook = context.portfolioBook;
        const stockAccount = new StockAccount(context.portfolioAccount);

        // New forward date
        const dateValue = +date.replaceAll('-', '');

        // Current realized date
        const realizedDateValue = stockAccount.getRealizedDateValue();
        // Current forwarded date
        const forwardedDateValue = stockAccount.getForwardedDateValue();

        // Summary
        const summary = new Summary();

        // Do NOT allow forward if account has uncalculated results
        const isUncalculated = await this.botService.isAccountUncalculated(
            stockBook,
            stockAccount.getAccount(),
            date
        );
        if (isUncalculated) {
            const errorMsg = 'Cannot set forward date: account has uncalculated results';
            return summary.forwardError(errorMsg);
        }

        // Do NOT allow forward if new date is equal the current forwarded date
        if (forwardedDateValue && dateValue === forwardedDateValue) {
            const errorMsg = `Cannot set forward date: account forwarded date is already ${this.botService.formatDate(stockBook, stockAccount.getForwardedDate()!)}`;
            return summary.forwardError(errorMsg);
        }

        // Forward fix: allow only if the conditions are met
        if (forwardedDateValue && dateValue < forwardedDateValue) {
            if (!this.isUserBookOwner(stockBook)) {
                const errorMsg = `Cannot lower forward date: user must be book owner`;
                return summary.forwardError(errorMsg);
            }
            if (!this.isCollectionUnlocked(stockBook)) {
                const errorMsg = `Cannot lower forward date: collection has locked/closed book(s)`;
                return summary.forwardError(errorMsg);
            }
            return this.fixAndForwardDateForAccount(context, stockAccount, date);
        }

        // Do NOT allow forward if new date is equal or below the current realized date
        if (realizedDateValue && dateValue <= realizedDateValue) {
            const errorMsg = `Cannot set forward date: account has realized results up to ${this.botService.formatDate(stockBook, stockAccount.getRealizedDate()!)}`;
            return summary.forwardError(errorMsg);
        }

        // Regular forward
        return this.forwardDateForAccount(context, date, false);
    }

    private async fixAndForwardDateForAccount(
        context: OperationContext,
        stockAccount: StockAccount,
        forwardDate: string
    ): Promise<Summary> {
        const stockBook = context.portfolioBook;

        // Reset results up to current forwarded date using the sequential Reset path
        await new ResetRealizedResultsService().executeSync(context, stockAccount, false);

        // Fix previous forward
        let transactions = await this.listTransactions(
            stockBook,
            `account:'${stockAccount.getName()}' after:${stockAccount.getForwardedDate()}`
        );
        let forwardedTransactions: Transaction[] = [];
        for (const tx of transactions) {
            if (tx.getProperty(FWD_LOG_PROP)) {
                forwardedTransactions.push(tx);
            }
        }
        for (const transaction of forwardedTransactions) {
            // Log operation status
            console.log(`processing transaction: ${transaction.getId()}`);

            // Get forwarded transaction previous state
            let previousStateTx = await this.getForwardedTransactionPreviousState(
                stockBook,
                stockAccount,
                transaction,
                forwardDate
            );
            // Return forwarded transaction to previous state
            await transaction
                .setDate(previousStateTx.getDate()!)
                .setVisibleProperties(previousStateTx.getProperties())
                .deleteProperty(FWD_TX_PROP)
                .deleteProperty(FWD_TX_REMOTE_IDS_PROP)
                .update();
            stockAccount.pushTrash(previousStateTx);
        }
        // Delete unnecessary transactions
        await stockAccount.cleanTrash();

        // Reset results up to new forward date using the sequential Reset path
        const resetTransactions = await this.listTransactions(
            stockBook,
            `account:'${stockAccount.getName()}' after:${forwardDate}`
        );
        await new ResetRealizedResultsService().executeSync(
            context,
            stockAccount,
            false,
            resetTransactions
        );

        // Set new forward date
        const newForward = await this.forwardDateForAccount(context, forwardDate, true);
        const newForwardMsg = newForward.getMessage().replaceAll(`"`, '').replace(`Done! `, '');
        const doneMsg = `Done! ${forwardedTransactions.length} fixed and ${newForwardMsg}`;
        return new Summary().done(doneMsg);
    }

    private async forwardDateForAccount(
        context: OperationContext,
        forwardDate: string,
        fixingForward: boolean
    ): Promise<Summary> {
        const stockBook = context.portfolioBook;
        const stockAccount = new StockAccount(context.portfolioAccount);

        // Do not allow forward if account needs rebuild
        if (stockAccount.needsRebuild()) {
            const errorMsg = 'Cannot set forward date: account needs rebuild';
            return new Summary().forwardError(errorMsg);
        }

        const baseBook = context.baseBook;
        const financialBook = context.financialBook;
        const baseExcCode = this.botService.getExcCode(baseBook)!;
        const stockExcCode = (await stockAccount.getExchangeCode())!;

        // Closing Date: Forward Date - 1 day
        const [year, month, day] = forwardDate.split('-').map(Number);
        const closingDateValue = new Date(Date.UTC(year, month - 1, day));
        closingDateValue.setUTCDate(closingDateValue.getUTCDate() - 1);
        // Closing Date ISO
        const closingDateISO = closingDateValue.toISOString().slice(0, 10);
        const closingDate = stockBook.parseDate(closingDateISO);
        const stockAccountName = stockAccount.getName()!;

        const stockBookBalancesReport = await stockBook.getBalancesReport(
            `account:'${stockAccountName}' on:${stockBook.formatDate(closingDate)}`
        );
        const baseBookBalancesReport = await baseBook.getBalancesReport(
            `account:'${stockAccountName}' on:${baseBook.formatDate(closingDate)}`
        );
        const financialBookBalancesReport = await financialBook.getBalancesReport(
            `account:'${stockAccountName}' on:${financialBook.formatDate(closingDate)}`
        );

        let needToRecordLiquidationTx = true;
        // Open amount from Base Book
        const openAmountBase = baseBookBalancesReport
            .getBalancesContainer(stockAccountName)
            .getCumulativeBalanceRaw();
        // Open amount from Local Book
        const openAmountLocal = financialBookBalancesReport
            .getBalancesContainer(stockAccountName)
            .getCumulativeBalanceRaw();
        // Open quantity from Stock Book
        let openQuantity = stockBookBalancesReport
            .getBalancesContainer(stockAccountName)
            .getCumulativeBalanceRaw();
        if (openQuantity.eq(0) && fixingForward) {
            openQuantity = await this.tryOpenQuantityFromLiquidationTx(
                stockBook,
                stockAccount,
                closingDateISO
            );
            if (!openQuantity.eq(0)) {
                needToRecordLiquidationTx = false;
            }
        }

        // Current price
        const fwdPrice = !openQuantity.eq(0) ? openAmountLocal.div(openQuantity) : undefined;
        // Current exchange rate
        const fwdExcRate = !openAmountLocal.eq(0) ? openAmountBase.div(openAmountLocal) : undefined;

        let transactions = await this.listTransactions(
            stockBook,
            `account:'${stockAccountName}' before:${forwardDate}`
        );
        transactions = transactions
            .filter(tx => !tx.isChecked())
            .sort(this.botService.compareToFIFO);

        const logTransactionsIds: string[] = [];
        const transactionsToCheck: Transaction[] = [];
        let order = -transactions.length;

        for (const transaction of transactions) {
            // Log operation status
            console.log(`processing transaction: ${transaction.getId()}`);

            // Post copy of transaction in order to keep a forward history
            const logTransaction = await this.buildLogTransaction(stockBook, transaction);
            await logTransaction.post();

            // Forward transaction
            await this.forwardTransaction(
                transaction,
                logTransaction,
                stockExcCode,
                baseExcCode,
                fwdPrice,
                fwdExcRate,
                forwardDate,
                order
            );

            logTransactionsIds.push(logTransaction.getId()!);
            transactionsToCheck.push(logTransaction);
            order++;
        }

        // Record new transaction liquidating the logs
        let liquidationTxId = '';
        if (needToRecordLiquidationTx && !openQuantity.eq(0)) {
            const liquidationTransaction = await this.buildLiquidationTransaction(
                stockBook,
                stockAccount,
                openQuantity,
                closingDate,
                forwardDate
            );
            liquidationTransaction.setProperty(
                FWD_LIQUIDATION_PROP,
                JSON.stringify(logTransactionsIds)
            );
            await liquidationTransaction.post();
            liquidationTxId = liquidationTransaction.getId()!;
            transactionsToCheck.push(liquidationTransaction);
        }

        // Check logs and liquidation transaction
        await stockBook.batchCheckTransactions(transactionsToCheck);

        const urFinancialBookBalancesReport = await financialBook.getBalancesReport(
            `account:'${stockAccountName} ${UNREALIZED_SUFFIX}' after:${stockAccount.getForwardedDate()} before:${forwardDate}`
        );
        const urBaseBookBalancesReport = await baseBook.getBalancesReport(
            `account:'${stockAccountName} ${UNREALIZED_SUFFIX}' after:${stockAccount.getForwardedDate()} before:${forwardDate}`
        );
        // Unrealized account balances
        const urBalanceLocal = this.getAccountBalance(
            urFinancialBookBalancesReport,
            `${stockAccountName} ${UNREALIZED_SUFFIX}`
        );
        const urBalanceBase = this.getAccountBalance(
            urBaseBookBalancesReport,
            `${stockAccountName} ${UNREALIZED_SUFFIX}`
        );

        // Record "Forwarded Results" (Unrealized account gap) - DO NOT RECORD IF BOOK IS HISTORICAL
        const model = this.botService.getCalculationModel(stockBook);
        if (
            model !== CalculationModel.HISTORICAL_ONLY &&
            liquidationTxId &&
            !urBalanceLocal.eq(0)
        ) {
            const forwardedResultTransaction = await this.buildForwardedResultTransaction(
                financialBook,
                baseBook,
                stockAccount,
                closingDate,
                urBalanceLocal,
                urBalanceBase
            );
            await forwardedResultTransaction
                .addRemoteId(`fwd_${liquidationTxId}`)
                .setChecked(true)
                .create();
        }

        // Update stock account
        await this.updateStockAccount(
            stockAccount,
            stockExcCode,
            baseExcCode,
            fwdPrice,
            fwdExcRate,
            forwardDate
        );

        if (
            (await this.isForwardedDateSameOnAllAccounts(stockBook, forwardDate)) &&
            stockBook.getClosingDate() != closingDateISO
        ) {
            // Prevent book from closing before last transaction check
            await this.delay(5000);
            await stockBook.setClosingDate(closingDateISO).update();
            const doneMsg = `Done! ${transactions.length} forwarded to ${this.botService.formatDate(stockBook, forwardDate)} and book closed on ${stockBook.formatDate(closingDate)}`;
            return new Summary().done(doneMsg);
        } else {
            const doneMsg = `Done! ${transactions.length} forwarded to ${this.botService.formatDate(stockBook, forwardDate)}`;
            return new Summary().done(doneMsg);
        }
    }

    private async forwardTransaction(
        transaction: Transaction,
        logTransaction: Transaction,
        stockExcCode: string,
        baseExcCode: string,
        fwdPrice: Amount | undefined,
        fwdExcRate: Amount | undefined,
        forwardDate: string,
        order: number
    ): Promise<void> {
        if (!transaction.getProperty(DATE_PROP)) {
            transaction.setProperty(DATE_PROP, transaction.getDate());
        }
        if (!transaction.getProperty(HIST_QUANTITY_PROP)) {
            transaction.setProperty(
                HIST_QUANTITY_PROP,
                transaction.getProperty(ORIGINAL_QUANTITY_PROP)
            );
        }
        if (!transaction.getProperty(HIST_ORDER_PROP)) {
            transaction.setProperty(HIST_ORDER_PROP, transaction.getProperty(ORDER_PROP));
        }
        if (await this.botService.isPurchase(transaction)) {
            transaction.setProperty(FWD_PURCHASE_PRICE_PROP, fwdPrice?.toString());
            if (stockExcCode !== baseExcCode) {
                transaction.setProperty(FWD_PURCHASE_EXC_RATE_PROP, fwdExcRate?.toString());
            }
        }
        if (await this.botService.isSale(transaction)) {
            transaction.setProperty(FWD_SALE_PRICE_PROP, fwdPrice?.toString());
            if (stockExcCode !== baseExcCode) {
                transaction.setProperty(FWD_SALE_EXC_RATE_PROP, fwdExcRate?.toString());
            }
        }
        await transaction
            .deleteProperty(ORIGINAL_AMOUNT_PROP)
            .setProperty(ORIGINAL_QUANTITY_PROP, transaction.getAmount()!.toString())
            .setProperty(ORDER_PROP, `${order}`)
            .setProperty(FWD_LOG_PROP, logTransaction.getId())
            .setDate(forwardDate)
            .update();
    }

    private async updateStockAccount(
        stockAccount: StockAccount,
        stockExcCode: string,
        baseExcCode: string,
        fwdPrice: Amount | undefined,
        fwdExcRate: Amount | undefined,
        forwardDate: string
    ): Promise<void> {
        stockAccount
            .setRealizedDate(forwardDate)
            .setForwardedDate(forwardDate)
            .setForwardedPrice(fwdPrice);
        if (stockExcCode !== baseExcCode) {
            stockAccount.setForwardedExcRate(fwdExcRate);
        }
        await stockAccount.update();
    }

    private async isForwardedDateSameOnAllAccounts(
        stockBook: Book,
        forwardedDate: string
    ): Promise<boolean> {
        for (const account of await stockBook.getAccounts()) {
            const stockAccount = new StockAccount(account);
            if (
                stockAccount.isPermanent() &&
                !stockAccount.isArchived() &&
                (await stockAccount.getExchangeCode())
            ) {
                if (stockAccount.getForwardedDate() != forwardedDate) {
                    return false;
                }
            }
        }
        return true;
    }

    private async buildLogTransaction(
        stockBook: Book,
        transaction: Transaction
    ): Promise<Transaction> {
        const remoteIds: string[] = transaction.getRemoteIds() || [];
        const creditAccount = await transaction.getCreditAccount();
        const debitAccount = await transaction.getDebitAccount();
        const logTransaction = new Transaction(stockBook)
            .from(creditAccount)
            .to(debitAccount)
            .setDescription(transaction.getDescription() ?? '')
            .setVisibleProperties(transaction.getProperties())
            .setProperty(FWD_TX_PROP, transaction.getId())
            .setProperty(FWD_TX_REMOTE_IDS_PROP, JSON.stringify(remoteIds));
        const amount = transaction.getAmount();
        if (amount) {
            logTransaction.setAmount(amount);
        }
        const date = transaction.getDate();
        if (date) {
            logTransaction.setDate(date);
        }
        return logTransaction;
    }

    private async buildLiquidationTransaction(
        stockBook: Book,
        stockAccount: StockAccount,
        quantity: Amount,
        closingDate: Date,
        forwardDate: string
    ): Promise<Transaction> {
        const fromAccount = quantity.lt(0)
            ? stockAccount.getAccount()
            : await this.botService.getBuyAccount(stockBook);
        const toAccount = quantity.lt(0)
            ? await this.botService.getSellAccount(stockBook)
            : stockAccount.getAccount();
        return new Transaction(stockBook)
            .setAmount(quantity.abs())
            .from(fromAccount)
            .to(toAccount)
            .setDate(closingDate)
            .setDescription(`${quantity.times(-1)} units forwarded to ${forwardDate}`);
    }

    private isUserBookOwner(stockBook: Book): boolean {
        return stockBook.getPermission() == Permission.OWNER;
    }

    private isCollectionUnlocked(stockBook: Book): boolean {
        const books = stockBook.getCollection()!.getBooks();
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

    private async getForwardedTransactionPreviousState(
        stockBook: Book,
        stockAccount: StockAccount,
        transaction: Transaction,
        forwardDate: string
    ): Promise<Transaction> {
        const previousStateId = transaction.getProperty(FWD_LOG_PROP);
        if (!previousStateId) {
            return transaction;
        }
        const previousStateTx = await optionalLookup(() =>
            stockBook.getTransaction(previousStateId)
        );
        if (!previousStateTx) {
            return transaction;
        }
        if (previousStateTx.getDateValue()! <= +forwardDate.replaceAll('-', '')) {
            return previousStateTx;
        }
        stockAccount.pushTrash(previousStateTx);
        return this.getForwardedTransactionPreviousState(
            stockBook,
            stockAccount,
            previousStateTx,
            forwardDate
        );
    }

    private async tryOpenQuantityFromLiquidationTx(
        stockBook: Book,
        stockAccount: StockAccount,
        closingDate: string
    ): Promise<Amount> {
        const transactions = await this.listTransactions(
            stockBook,
            `account:'${stockAccount.getName()}' on:${closingDate}`
        );
        for (const tx of transactions) {
            if (tx.getProperty(FWD_LIQUIDATION_PROP)) {
                const amount = tx.getAmount()!;
                if (await this.botService.isPurchase(tx)) {
                    return amount;
                }
                if (await this.botService.isSale(tx)) {
                    return amount.times(-1);
                }
            }
        }
        return new Amount(0);
    }

    private getAccountBalance(report: BalancesReport, accountName: string): Amount {
        let balance = new Amount(0);
        try {
            balance = report.getBalancesContainer(accountName).getCumulativeBalance();
        } catch (error) {
            // console.log(error);
        }
        return balance;
    }

    private async buildForwardedResultTransaction(
        financialBook: Book,
        baseBook: Book,
        stockAccount: StockAccount,
        closingDate: Date,
        localAmount: Amount,
        baseAmount: Amount
    ): Promise<Transaction> {
        const isBaseBook = baseBook.getId() === financialBook.getId();

        const unrealizedAccount = await this.botService.getSupportAccount(
            financialBook,
            stockAccount,
            UNREALIZED_SUFFIX,
            await this.botService.getTypeByAccountSuffix(financialBook, UNREALIZED_SUFFIX)
        );
        const forwardedAccount = await this.botService.getSupportAccount(
            financialBook,
            stockAccount,
            FORWARDED_SUFFIX,
            AccountType.LIABILITY
        );
        const fromAccount = localAmount.gt(0) ? forwardedAccount : unrealizedAccount;
        const toAccount = localAmount.gt(0) ? unrealizedAccount : forwardedAccount;
        const description = localAmount.gt(0) ? '#stock_gain_fwd' : '#stock_loss_fwd';

        return new Transaction(financialBook)
            .from(fromAccount)
            .to(toAccount)
            .setAmount(localAmount.abs())
            .setDate(closingDate)
            .setDescription(description)
            .setProperty(
                EXC_AMOUNT_PROP,
                this.getForwardedResultTransactionExcAmountProp(
                    financialBook,
                    isBaseBook,
                    baseAmount
                )
            )
            .setProperty(
                EXC_CODE_PROP,
                this.getForwardedResultTransactionExcCodeProp(financialBook, isBaseBook, baseBook)
            );
    }

    private getForwardedResultTransactionExcAmountProp(
        financialBook: Book,
        isBaseBook: boolean,
        baseAmount: Amount
    ): string | null {
        if (!this.botService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : baseAmount.abs().toString();
    }

    private getForwardedResultTransactionExcCodeProp(
        financialBook: Book,
        isBaseBook: boolean,
        baseBook: Book
    ): string | null | undefined {
        if (!this.botService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : this.botService.getExcCode(baseBook);
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

    private delay(milliseconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}
