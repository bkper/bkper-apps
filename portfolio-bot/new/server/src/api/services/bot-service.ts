import { Account, AccountType, Amount, type Book, type Group, type Transaction } from 'bkper-js';
import {
    EXC_ACCOUNT_PROP,
    EXC_BASE_PROP,
    EXC_CODE_PROP,
    EXC_RATE_PROP,
    FWD_PURCHASE_PRICE_PROP,
    FWD_SALE_PRICE_PROP,
    ORDER_PROP,
    PRICE_PROP,
    PURCHASE_PRICE_HIST_PROP,
    PURCHASE_PRICE_PROP,
    SALE_PRICE_HIST_PROP,
    SALE_PRICE_PROP,
    STOCK_BUY_ACCOUNT_NAME,
    STOCK_EXC_CODE_PROP,
    STOCK_FAIR_PROP,
    STOCK_HISTORICAL_PROP,
    STOCK_SELL_ACCOUNT_NAME,
    TRADE_EXC_RATE_HIST_PROP,
    TRADE_EXC_RATE_PROP,
} from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { CalculationModel } from './calculate/types.js';
import type { StockAccount } from './stock-account.js';
import { ValidationAccount } from './validation-account.js';

export class BotService {
    getBaseBook(book: Book): Book | null {
        const collection = book.getCollection();
        if (collection == null) {
            return null;
        }
        const connectedBooks = collection.getBooks();
        for (const connectedBook of connectedBooks) {
            if (connectedBook.getProperty(EXC_BASE_PROP)) {
                return connectedBook;
            }
        }
        for (const connectedBook of connectedBooks) {
            if (connectedBook.getProperty(EXC_CODE_PROP) == 'USD') {
                return connectedBook;
            }
        }
        return null;
    }

    getFinancialBook(book: Book, excCode?: string | null): Book | null {
        const collection = book.getCollection();
        if (!collection) {
            return null;
        }
        for (const connectedBook of collection.getBooks()) {
            if (
                connectedBook.getFractionDigits() != 0 &&
                this.getExcCode(connectedBook) == excCode
            ) {
                return connectedBook;
            }
        }
        return null;
    }

    getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    hasBaseBookDefined(book: Book): boolean {
        const collection = book.getCollection();
        if (!collection) {
            return false;
        }
        for (const connectedBook of collection.getBooks()) {
            if (connectedBook.getProperty(EXC_BASE_PROP)) {
                return true;
            }
        }
        return false;
    }

    getCalculationModel(stockBook: Book): CalculationModel {
        if (this.isHistoricalOnly(stockBook)) {
            return CalculationModel.HISTORICAL_ONLY;
        }
        if (this.isFairOnly(stockBook)) {
            return CalculationModel.FAIR_ONLY;
        }
        return CalculationModel.BOTH;
    }

    private isFlaggedAsHistorical(stockBook: Book): boolean {
        const stockHistoricalProp = stockBook.getProperty(STOCK_HISTORICAL_PROP);
        return Boolean(stockHistoricalProp?.trim().toLowerCase() === 'true');
    }

    private isFlaggedAsFair(stockBook: Book): boolean {
        const stockFairProp = stockBook.getProperty(STOCK_FAIR_PROP);
        return Boolean(stockFairProp?.trim().toLowerCase() === 'true');
    }

    private isHistoricalOnly(stockBook: Book): boolean {
        return this.isFlaggedAsHistorical(stockBook) && !this.isFlaggedAsFair(stockBook);
    }

    private isFairOnly(stockBook: Book): boolean {
        return this.isFlaggedAsFair(stockBook) && !this.isFlaggedAsHistorical(stockBook);
    }

    isBookOpenAndUnlocked(book: Book): boolean {
        const lockDate = book.getLockDate();
        const closingDate = book.getClosingDate();
        return (
            (!lockDate || lockDate === '1900-00-00') &&
            (!closingDate || closingDate === '1900-00-00')
        );
    }

    getAccountQuery(stockAccount: StockAccount, full: boolean, beforeDate?: string): string {
        let query = `account:'${stockAccount.getName()}'`;
        if (!full && stockAccount.getForwardedDate()) {
            query += ` after:${stockAccount.getForwardedDate()}`;
        }
        if (beforeDate) {
            query += ` before:${beforeDate}`;
        }
        return query;
    }

    getBeforeDateIsoString(_book: Book, toDateIsoString: string): string {
        return this.getNextIsoDate(toDateIsoString);
    }

    formatDate(book: Book, date: string): string {
        return book.formatDate(book.parseDate(date));
    }

    async getUncalculatedAccounts(stockBook: Book, baseBook?: Book): Promise<Account[]> {
        const baseBookCurrency = baseBook ? this.getExcCode(baseBook) : undefined;

        const validationAccountsMap = new Map<string | undefined, ValidationAccount>();

        const stockBookAccounts = await stockBook.getAccounts();
        for (const account of stockBookAccounts) {
            if (account.isPermanent()) {
                validationAccountsMap.set(account.getName(), new ValidationAccount(account));
            }
        }

        const query = this.getUncalculatedAccountsQuery(stockBook);
        let cursor: string | undefined;
        do {
            const transactionList = await stockBook.listTransactions(query, undefined, cursor);
            for (const transaction of transactionList.getItems()) {
                const creditAccount = await transaction.getCreditAccount();
                const debitAccount = await transaction.getDebitAccount();
                if (!creditAccount || !debitAccount) {
                    throw new Error(
                        `Could not resolve both Accounts for Transaction ${transaction.getId() ?? 'unknown'} while listing pending-calculation Accounts.`
                    );
                }
                const account = creditAccount.isPermanent() ? creditAccount : debitAccount;
                const validationAccount = validationAccountsMap.get(account.getName());
                if (
                    !validationAccount ||
                    validationAccount.needsRebuild() ||
                    validationAccount.hasUncalculatedResults()
                ) {
                    continue;
                }
                const contraAccount = creditAccount.isPermanent() ? debitAccount : creditAccount;
                if (contraAccount.getName() == STOCK_BUY_ACCOUNT_NAME) {
                    validationAccount.pushUncheckedPurchase(transaction);
                }
                if (contraAccount.getName() == STOCK_SELL_ACCOUNT_NAME) {
                    validationAccount.pushUncheckedSale(transaction);
                }
            }
            cursor = transactionList.getCursor();
        } while (cursor);

        const uncalculatedAccounts: Account[] = [];

        for (const validationAccount of validationAccountsMap.values()) {
            if (validationAccount.needsRebuild() || validationAccount.hasUncalculatedResults()) {
                uncalculatedAccounts.push(validationAccount.getAccount());
                continue;
            }
            const missingExcRates =
                await validationAccount.hasTransactionsMissingExcRates(baseBookCurrency);
            if (baseBookCurrency && missingExcRates) {
                uncalculatedAccounts.push(validationAccount.getAccount());
            }
        }

        return uncalculatedAccounts;
    }

    getUncalculatedAccountsQuery(stockBook: Book): string {
        const closingDateIso = stockBook.getClosingDate();
        if (closingDateIso && closingDateIso !== '1900-00-00') {
            return `after:${this.getNextIsoDate(closingDateIso)} is:unchecked`;
        }
        return 'is:unchecked';
    }

    async getBuyAccount(book: Book): Promise<Account> {
        const account = await optionalLookup(() => book.getAccount(STOCK_BUY_ACCOUNT_NAME));
        if (account) {
            return account;
        }
        return new Account(book)
            .setName(STOCK_BUY_ACCOUNT_NAME)
            .setType(AccountType.INCOMING)
            .create();
    }

    async getSellAccount(book: Book): Promise<Account> {
        const account = await optionalLookup(() => book.getAccount(STOCK_SELL_ACCOUNT_NAME));
        if (account) {
            return account;
        }
        return new Account(book)
            .setName(STOCK_SELL_ACCOUNT_NAME)
            .setType(AccountType.OUTGOING)
            .create();
    }

    async isAccountUncalculated(
        stockBook: Book,
        stockAccount: Account,
        forwardDate: string
    ): Promise<boolean> {
        const validationAccount = new ValidationAccount(stockAccount);
        const query = `account:'${stockAccount.getName()}' before:${forwardDate}`;
        let cursor: string | undefined;

        do {
            const page = await stockBook.listTransactions(query, undefined, cursor);
            for (const transaction of page.getItems()) {
                if (validationAccount.hasUncalculatedResults()) {
                    return false;
                }
                if (transaction.isChecked()) {
                    continue;
                }
                const creditAccount = await transaction.getCreditAccount();
                const debitAccount = await transaction.getDebitAccount();
                if (!creditAccount || !debitAccount) {
                    throw new Error(
                        `Could not resolve both Accounts for Transaction ${transaction.getId() ?? 'unknown'} while validating Forward Date.`
                    );
                }
                const contraAccount = creditAccount.isPermanent() ? debitAccount : creditAccount;
                if (contraAccount.getName() == STOCK_BUY_ACCOUNT_NAME) {
                    validationAccount.pushUncheckedPurchase(transaction);
                }
                if (contraAccount.getName() == STOCK_SELL_ACCOUNT_NAME) {
                    validationAccount.pushUncheckedSale(transaction);
                }
            }
            cursor = page.getCursor();
        } while (cursor);

        return validationAccount.hasUncalculatedResults();
    }

    private getNextIsoDate(dateIso: string): string {
        const [year, month, day] = dateIso.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() + 1);
        return date.toISOString().slice(0, 10);
    }

    async isSale(transaction: Transaction): Promise<boolean> {
        return (
            Boolean(transaction.isPosted()) &&
            (await transaction.getDebitAccount())!.getType() == AccountType.OUTGOING
        );
    }

    async isPurchase(transaction: Transaction): Promise<boolean> {
        return (
            Boolean(transaction.isPosted()) &&
            (await transaction.getCreditAccount())!.getType() == AccountType.INCOMING
        );
    }

    compareToFIFO(tx1: Transaction, tx2: Transaction): number {
        let result = Number(tx1.getDateValue()) - Number(tx2.getDateValue());
        if (result == 0) {
            const order1 = tx1.getProperty(ORDER_PROP) ? +tx1.getProperty(ORDER_PROP)! : 0;
            const order2 = tx2.getProperty(ORDER_PROP) ? +tx2.getProperty(ORDER_PROP)! : 0;
            result = order1 - order2;
        }
        const createdAt1 = tx1.getCreatedAt();
        const createdAt2 = tx2.getCreatedAt();
        if (result == 0 && createdAt1 && createdAt2) {
            result = createdAt1.getMilliseconds() - createdAt2.getMilliseconds();
        }
        return result;
    }

    getHistSalePrice(saleTransaction: Transaction): Amount {
        return new Amount(
            saleTransaction.getProperty(SALE_PRICE_HIST_PROP, SALE_PRICE_PROP, PRICE_PROP)!
        );
    }

    getSalePrice(saleTransaction: Transaction): Amount {
        const fwdSalePriceProp = saleTransaction.getProperty(FWD_SALE_PRICE_PROP);
        if (fwdSalePriceProp) {
            return new Amount(fwdSalePriceProp);
        }
        return new Amount(saleTransaction.getProperty(SALE_PRICE_PROP, PRICE_PROP)!);
    }

    getHistPurchasePrice(purchaseTransaction: Transaction): Amount {
        return new Amount(
            purchaseTransaction.getProperty(
                PURCHASE_PRICE_HIST_PROP,
                PURCHASE_PRICE_PROP,
                PRICE_PROP
            )!
        );
    }

    getPurchasePrice(purchaseTransaction: Transaction): Amount {
        const fwdPurchasePriceProp = purchaseTransaction.getProperty(FWD_PURCHASE_PRICE_PROP);
        if (fwdPurchasePriceProp) {
            return new Amount(fwdPurchasePriceProp);
        }
        return new Amount(purchaseTransaction.getProperty(PURCHASE_PRICE_PROP, PRICE_PROP)!);
    }

    async getExcRate(
        baseBook: Book,
        financialBook: Book,
        stockTransaction: Transaction,
        excRateProp: string
    ): Promise<Amount | undefined> {
        if (!this.hasBaseBookDefined(financialBook)) {
            return undefined;
        }
        if (baseBook.getProperty(EXC_CODE_PROP) == financialBook.getProperty(EXC_CODE_PROP)) {
            return undefined;
        }
        if (this.hasProvidedTradeExcRates(stockTransaction)) {
            return this.getTradeExcRate(stockTransaction);
        }
        const excRate = stockTransaction.getProperty(excRateProp);
        if (excRate) {
            return new Amount(excRate);
        }
        for (const remoteId of stockTransaction.getRemoteIds()) {
            try {
                const financialTransaction = await financialBook.getTransaction(remoteId);
                if (!financialTransaction) {
                    continue;
                }
                const query = `remoteId:${financialTransaction.getId()}`;
                let cursor: string | undefined;
                do {
                    const transactionList = await baseBook.listTransactions(
                        query,
                        undefined,
                        cursor
                    );
                    for (const baseTransaction of transactionList.getItems()) {
                        const replicatedRate = baseTransaction.getProperty(
                            EXC_RATE_PROP,
                            'exc_base_rate'
                        );
                        if (replicatedRate) {
                            return new Amount(replicatedRate);
                        }
                    }
                    cursor = transactionList.getCursor();
                } while (cursor);
            } catch (error) {
                console.log(error);
            }
        }
        return undefined;
    }

    getFwdExcRate(
        stockTransaction: Transaction,
        fwdExcRateProp: string,
        fallbackExcRate: Amount | undefined
    ): Amount | undefined {
        if (this.hasProvidedTradeExcRates(stockTransaction)) {
            return this.getFwdTradeExcRate(stockTransaction, fwdExcRateProp);
        }
        const fwdExcRate = stockTransaction.getProperty(fwdExcRateProp);
        if (fwdExcRate) {
            return new Amount(fwdExcRate);
        }
        return fallbackExcRate;
    }

    getTradeExcRate(stockTransaction: Transaction): Amount | undefined {
        return this.findTradeExcRate(stockTransaction, TRADE_EXC_RATE_HIST_PROP);
    }

    getFwdTradeExcRate(stockTransaction: Transaction, fwdExcRateProp: string): Amount | undefined {
        const fwdExcRate = stockTransaction.getProperty(fwdExcRateProp);
        if (fwdExcRate) {
            return new Amount(fwdExcRate);
        }
        return this.findTradeExcRate(stockTransaction, TRADE_EXC_RATE_PROP);
    }

    private hasProvidedTradeExcRates(stockTransaction: Transaction): boolean {
        return Boolean(
            stockTransaction.getProperty(TRADE_EXC_RATE_PROP) ||
            stockTransaction.getProperty(TRADE_EXC_RATE_HIST_PROP)
        );
    }

    private findTradeExcRate(
        stockTransaction: Transaction,
        tradeExcRateProp: string
    ): Amount | undefined {
        const tradeExcRate = stockTransaction.getProperty(tradeExcRateProp);
        return tradeExcRate ? new Amount(tradeExcRate) : undefined;
    }

    calculateGainBaseNoFX(
        gainLocal: Amount,
        purchaseRate: Amount | undefined,
        saleRate: Amount | undefined,
        shortSale: boolean
    ): Amount {
        if (!purchaseRate || !saleRate) {
            return new Amount(0);
        }
        if (shortSale) {
            return gainLocal.times(purchaseRate);
        }
        return gainLocal.times(saleRate);
    }

    calculateGainBaseWithFX(
        purchaseAmount: Amount,
        purchaseRate: Amount | undefined,
        saleAmount: Amount,
        saleRate: Amount | undefined
    ): Amount {
        if (!purchaseRate || !saleRate) {
            return new Amount(0);
        }
        return saleAmount.times(saleRate).minus(purchaseAmount.times(purchaseRate));
    }

    async getAccountExcCode(account: Account): Promise<string | null> {
        for (const group of await account.getGroups()) {
            const stockExcCode = group.getProperty(STOCK_EXC_CODE_PROP);
            if (stockExcCode && stockExcCode.trim()) {
                return stockExcCode;
            }
        }
        return null;
    }

    async getInterestAccount(book: Book, principalAccountName: string): Promise<Account | null> {
        const formattedInterestAccountName = `${principalAccountName.toLowerCase().trim()} interest`;
        return (await optionalLookup(() => book.getAccount(formattedInterestAccountName))) ?? null;
    }

    async getSupportAccount(
        book: Book,
        stockAccount: StockAccount | Account,
        suffix: string,
        accountType: AccountType
    ): Promise<Account> {
        const supportAccountName = `${stockAccount.getName()} ${suffix}`;
        const existingAccount = await optionalLookup(() => book.getAccount(supportAccountName));
        if (existingAccount) {
            return existingAccount;
        }
        const supportAccount = new Account(book).setName(supportAccountName).setType(accountType);
        const groups = await this.getGroupsByAccountSuffix(book, suffix);
        for (const group of groups) {
            supportAccount.addGroup(group);
        }
        return supportAccount.create();
    }

    async getGroupsByAccountSuffix(book: Book, suffix: string): Promise<Set<Group>> {
        const accountNames = new Set<string>();
        for (const account of await book.getAccounts()) {
            const accountName = account.getName();
            if (accountName?.endsWith(` ${suffix}`)) {
                accountNames.add(accountName);
            }
        }

        const groups = new Set<Group>();
        if (accountNames.size === 0) {
            return groups;
        }
        for (const group of await book.getGroups()) {
            const groupAccounts = await group.getAccounts();
            if (groupAccounts.length === 0) {
                continue;
            }
            let shouldAddGroup = true;
            for (const accountName of accountNames) {
                const account = await optionalLookup(() => book.getAccount(accountName));
                if (!account) {
                    continue;
                }
                const accountGroups = await account.getGroups();
                if (!accountGroups.some(accountGroup => accountGroup.getId() === group.getId())) {
                    shouldAddGroup = false;
                    break;
                }
            }
            if (shouldAddGroup) {
                groups.add(group);
            }
        }
        return groups;
    }

    async getTypeByAccountSuffix(book: Book, suffix: string): Promise<AccountType> {
        const accountTypes = new Map<AccountType, Account[]>();
        for (const account of await book.getAccounts()) {
            if (!account.getName()?.endsWith(` ${suffix}`)) {
                continue;
            }
            const mappedAccounts = accountTypes.get(account.getType());
            if (mappedAccounts) {
                mappedAccounts.push(account);
            } else {
                accountTypes.set(account.getType(), [account]);
            }
        }
        let maxOccurrencesType = AccountType.LIABILITY;
        let maxOccurrences = 1;
        for (const [accountType, accounts] of accountTypes) {
            if (accounts.length > maxOccurrences) {
                maxOccurrences = accounts.length;
                maxOccurrencesType = accountType;
            }
        }
        return maxOccurrencesType;
    }

    async getRealizedExcAccountType(book: Book): Promise<AccountType> {
        const excAccountNames = new Set<string>();
        for (const account of await book.getAccounts()) {
            const excAccountProp = account.getProperty(EXC_ACCOUNT_PROP);
            if (excAccountProp) {
                excAccountNames.add(excAccountProp);
            }
            const accountName = account.getName();
            if (accountName?.startsWith('Exchange_') || accountName?.endsWith(' EXC')) {
                excAccountNames.add(accountName);
            }
        }

        const excAccountTypes = new Map<AccountType, Account[]>();
        for (const accountName of excAccountNames) {
            const account = await optionalLookup(() => book.getAccount(accountName));
            if (!account) {
                continue;
            }
            const mappedAccounts = excAccountTypes.get(account.getType());
            if (mappedAccounts) {
                mappedAccounts.push(account);
            } else {
                excAccountTypes.set(account.getType(), [account]);
            }
        }
        let maxOccurrencesType = AccountType.LIABILITY;
        let maxOccurrences = 1;
        for (const [accountType, accounts] of excAccountTypes) {
            if (accounts.length > maxOccurrences) {
                maxOccurrences = accounts.length;
                maxOccurrencesType = accountType;
            }
        }
        return maxOccurrencesType;
    }
}
