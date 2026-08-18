namespace BotService {

    function isFlaggedAsHistorical(stockBook: Bkper.Book): boolean {
        const stockHistoricalProp = stockBook.getProperty(STOCK_HISTORICAL_PROP);
        return stockHistoricalProp && stockHistoricalProp.trim().toLowerCase() === 'true' ? true : false;
    }

    function isFlaggedAsFair(stockBook: Bkper.Book): boolean {
        const stockFairProp = stockBook.getProperty(STOCK_FAIR_PROP);
        return stockFairProp && stockFairProp.trim().toLowerCase() === 'true' ? true : false;
    }

    function isHistoricalOnly(stockBook: Bkper.Book): boolean {
        return isFlaggedAsHistorical(stockBook) && !isFlaggedAsFair(stockBook);
    }

    function isFairOnly(stockBook: Bkper.Book): boolean {
        return isFlaggedAsFair(stockBook) && !isFlaggedAsHistorical(stockBook);
    }

    export function getCalculationModel(stockBook: Bkper.Book): CalculationModel {
        if (isHistoricalOnly(stockBook)) {
            return CalculationModel.HISTORICAL_ONLY;
        }
        if (isFairOnly(stockBook)) {
            return CalculationModel.FAIR_ONLY;
        }
        return CalculationModel.BOTH;
    }

    export function auditBooks(bookId: string): void {
        let book = BkperApp.getBook(bookId);
        let connectedBooks = book.getCollection().getBooks();
        connectedBooks.forEach(b => {
            b.audit();
        });
    }

    export function chunk(data: any[], size: number): any[][] {
        const quotient = Math.floor(data.length / size);
        const remainder = data.length % size;
        const numberOfChunks = (remainder == 0) ? quotient : quotient + 1;
        let result: any[][][] = [];
        for (let i = 0; i < numberOfChunks; i++) {
            let chunk = data.slice(size * i, size * (i + 1));
            result.push(chunk);
        }
        return result;
    }

    export function getBeforeDateIsoString(book: Bkper.Book, toDateIsoString: string): string {
        const toDate = book.parseDate(toDateIsoString);
        let beforeDate = new Date();
        beforeDate.setTime(toDate.getTime());
        beforeDate.setDate(beforeDate.getDate() + 1);
        return Utilities.formatDate(beforeDate, book.getTimeZone(), 'yyyy-MM-dd');
    }

    function parseDateParam(dateParam: string): Date {
        var dateSplit = dateParam.split('-');
        let year = new Number(dateSplit[0]).valueOf();
        let month = new Number(dateSplit[1]).valueOf() - 1;
        let day = new Number(dateSplit[2]).valueOf();
        var date = new Date(year, month, day, 13, 0, 0, 0);
        return date;
    }

    export function formatDate(date: string, timeZone: string, format: string): string {
        return Utilities.formatDate(parseDateParam(date), timeZone, format);
    }

    export function getAccountQuery(stockAccount: StockAccount, full: boolean, beforeDate?: string) {
        let query = `account:'${stockAccount.getName()}'`;

        if (!full && stockAccount.getForwardedDate()) {
            query += ` after:${stockAccount.getForwardedDate()}`
        }

        if (beforeDate) {
            query += ` before:${beforeDate}`
        }
        return query;
    }

    export function getInterestAccount(book: Bkper.Book, principalAccountName: string): Bkper.Account | null {
        const formattedInterestAccountName = `${principalAccountName.toLowerCase().trim()} interest`;
        const interestAccount = book.getAccount(formattedInterestAccountName);
        return interestAccount || null;
    }

    export function getHistSalePrice(saleTransaction: Bkper.Transaction): Bkper.Amount {
        return BkperApp.newAmount(saleTransaction.getProperty(SALE_PRICE_HIST_PROP, SALE_PRICE_PROP, PRICE_PROP));
    }

    export function getSalePrice(saleTransaction: Bkper.Transaction): Bkper.Amount {
        const fwdSalePriceProp = saleTransaction.getProperty(FWD_SALE_PRICE_PROP);
        if (fwdSalePriceProp) {
            return BkperApp.newAmount(fwdSalePriceProp);
        }
        return BkperApp.newAmount(saleTransaction.getProperty(SALE_PRICE_PROP, PRICE_PROP));
    }

    export function getHistPurchasePrice(purchaseTransaction: Bkper.Transaction): Bkper.Amount {
        return BkperApp.newAmount(purchaseTransaction.getProperty(PURCHASE_PRICE_HIST_PROP, PURCHASE_PRICE_PROP, PRICE_PROP));
    }

    export function getPurchasePrice(purchaseTransaction: Bkper.Transaction): Bkper.Amount {
        const fwdPurchasePriceProp = purchaseTransaction.getProperty(FWD_PURCHASE_PRICE_PROP);
        if (fwdPurchasePriceProp) {
            return BkperApp.newAmount(fwdPurchasePriceProp);
        }
        return BkperApp.newAmount(purchaseTransaction.getProperty(PURCHASE_PRICE_PROP, PRICE_PROP));
    }

    export function calculateGainBaseNoFX(gainLocal: Bkper.Amount, purchaseRate: Bkper.Amount, saleRate: Bkper.Amount, shortSale: boolean): Bkper.Amount {
        if (!purchaseRate || !saleRate) {
            return BkperApp.newAmount(0);
        }
        if (shortSale) {
            return gainLocal.times(purchaseRate);
        } else {
            return gainLocal.times(saleRate)
        }
    }

    export function calculateGainBaseWithFX(purchaseAmount: Bkper.Amount, purchaseRate: Bkper.Amount, saleAmount: Bkper.Amount, saleRate: Bkper.Amount): Bkper.Amount {
        if (!purchaseRate || !saleRate) {
            return BkperApp.newAmount(0);
        }
        return saleAmount.times(saleRate).minus(purchaseAmount.times(purchaseRate))
    }

    export function getFwdExcRate(stockTransaction: Bkper.Transaction, fwdExcRateProp: string, fallbackExcRate: Bkper.Amount): Bkper.Amount {
        // If specific trade exc rate was provided, use it
        if (hasProvidedTradeExcRates(stockTransaction)) {
            return getFwdTradeExcRate(stockTransaction, fwdExcRateProp);
        }
        const fwdExcRate = stockTransaction.getProperty(fwdExcRateProp);
        if (fwdExcRate) {
            return BkperApp.newAmount(fwdExcRate);
        }
        return fallbackExcRate;
    }

    export function getExcRate(baseBook: Bkper.Book, financialBook: Bkper.Book, stockTransaction: Bkper.Transaction, excRateProp: string): Bkper.Amount {

        // No base book defined
        if (!BotService.hasBaseBookDefined(financialBook)) {
            return undefined;
        }

        // Base currency
        if (baseBook.getProperty(EXC_CODE_PROP) == financialBook.getProperty(EXC_CODE_PROP)) {
            return undefined;
        }

        // If specific trade exc rate was provided, use it
        if (hasProvidedTradeExcRates(stockTransaction)) {
            return getTradeExcRate(stockTransaction);
        }

        // Exc rate already set
        if (stockTransaction.getProperty(excRateProp)) {
            return BkperApp.newAmount(stockTransaction.getProperty(excRateProp));
        }

        // No remote ids
        if (!stockTransaction.getRemoteIds()) {
            return undefined;
        }

        // Get from replicated transaction
        for (const remoteId of stockTransaction.getRemoteIds()) {
            try {
                const financialTransaction = financialBook.getTransaction(remoteId);
                const baseIterator = baseBook.getTransactions(`remoteId:${financialTransaction.getId()}`);
                while (baseIterator.hasNext()) {
                    const baseTransaction = baseIterator.next();
                    if (baseTransaction.getProperty(EXC_RATE_PROP, 'exc_base_rate')) {
                        return BkperApp.newAmount(baseTransaction.getProperty(EXC_RATE_PROP, 'exc_base_rate'));
                    }
                }
            } catch (err) {
                Logger.log(err);
            }
        }

        return undefined;
    }

    function hasProvidedTradeExcRates(stockTransaction: Bkper.Transaction): boolean {
        const tradeExcRateProp = stockTransaction.getProperty(TRADE_EXC_RATE_PROP);
        const tradeExcRateHistProp = stockTransaction.getProperty(TRADE_EXC_RATE_HIST_PROP);
        return (tradeExcRateProp || tradeExcRateHistProp) ? true : false;
    }

    function findTradeExcRate(stockTransaction: Bkper.Transaction, tradeExcRateProp: string): Bkper.Amount | undefined {
        const tradeExcRate = stockTransaction.getProperty(tradeExcRateProp);
        if (tradeExcRate) {
            return BkperApp.newAmount(tradeExcRate);
        }
        return undefined;
    }

    export function getFwdTradeExcRate(stockTransaction: Bkper.Transaction, fwdExcRateProp: string): Bkper.Amount | undefined {
        // Try last fwd exc rate set
        const fwdExcRate = stockTransaction.getProperty(fwdExcRateProp);
        if (fwdExcRate) {
            return BkperApp.newAmount(fwdExcRate);
        }
        // Fallback to original provided trade exc rate
        const tradeExcRate = findTradeExcRate(stockTransaction, TRADE_EXC_RATE_PROP);
        if (tradeExcRate) {
            return tradeExcRate;
        }
        return undefined;
    }

    export function getTradeExcRate(stockTransaction: Bkper.Transaction): Bkper.Amount | undefined {
        const tradeExcRateHist = stockTransaction.getProperty(TRADE_EXC_RATE_HIST_PROP);
        if (tradeExcRateHist) {
            return BkperApp.newAmount(tradeExcRateHist);
        }
        return undefined;
    }

    export function getBaseBook(book: Bkper.Book): Bkper.Book {
        if (book.getCollection() == null) {
            // @ts-ignore
            console.log(`Collection of book ${book.getName()} id ${book.getId()}: ${book.wrapped}`);
            return null;
        }
        let connectedBooks = book.getCollection().getBooks();
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
        console.log('No base book')
        return null;
    }

    export function hasBaseBookDefined(book: Bkper.Book): boolean {
        if (book.getCollection() == null) {
            return false;
        }
        let connectedBooks = book.getCollection().getBooks();
        for (const connectedBook of connectedBooks) {
            if (connectedBook.getProperty(EXC_BASE_PROP)) {
                return true;
            }
        }
        return false;
    }

    export function getStockBook(book: Bkper.Book): Bkper.Book {
        if (book.getCollection() == null) {
            return null;
        }
        let connectedBooks = book.getCollection().getBooks();
        for (const connectedBook of connectedBooks) {
            if (connectedBook.getProperty(STOCK_BOOK_PROP)) {
                return connectedBook;
            }
            let fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits == 0) {
                return connectedBook;
            }
        }
        return null;
    }

    export function getFinancialBook(book: Bkper.Book, excCode?: string): Bkper.Book {
        if (book.getCollection() == null) {
            return null;
        }
        let connectedBooks = book.getCollection().getBooks();
        for (const connectedBook of connectedBooks) {
            let excCodeConnectedBook = getExcCode(connectedBook);
            let fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits != 0 && excCode == excCodeConnectedBook) {
                return BkperApp.getBook(connectedBook.getId());
            }
        }
        return null;
    }

    export function getBooksExcCodesUserCanEdit(book: Bkper.Book): Set<string> {
        const collection = book.getCollection();
        if (collection) {
            let excCodes = new Set<string>();
            for (const book of collection.getBooks()) {
                const bookExcCodeProp = book.getProperty(EXC_CODE_PROP, 'exchange_code');
                if (bookExcCodeProp && canUserEditBook(book)) {
                    excCodes.add(bookExcCodeProp);
                }
            }
            return excCodes;
        }
        return new Set<string>();
    }

    function canUserEditBook(book: Bkper.Book): boolean {
        return (book.getPermission() === BkperApp.Permission.OWNER || book.getPermission() === BkperApp.Permission.EDITOR) ? true : false;
    }

    export function isSale(transaction: Bkper.Transaction): boolean {
        return transaction.isPosted() && transaction.getDebitAccount().getType() == BkperApp.AccountType.OUTGOING;
    }

    export function isPurchase(transaction: Bkper.Transaction): boolean {
        return transaction.isPosted() && transaction.getCreditAccount().getType() == BkperApp.AccountType.INCOMING;
    }

    export function getExcCode(book: Bkper.Book): string {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    export function compareToFIFO(tx1: Bkper.Transaction, tx2: Bkper.Transaction): number {

        let ret = tx1.getDateValue() - tx2.getDateValue()

        if (ret == 0) {
            const order1 = tx1.getProperty(ORDER_PROP) ? +tx1.getProperty(ORDER_PROP) : 0;
            const order2 = tx2.getProperty(ORDER_PROP) ? +tx2.getProperty(ORDER_PROP) : 0;
            ret = order1 - order2;
        }

        if (ret == 0 && tx1.getCreatedAt() && tx2.getCreatedAt()) {
            ret = tx1.getCreatedAt().getMilliseconds() - tx2.getCreatedAt().getMilliseconds();
        }

        return ret;
    }

    export function getUncalculatedAccounts(stockBook: Bkper.Book, baseBook?: Bkper.Book): Bkper.Account[] {

        const baseBookCurrency = baseBook ? BotService.getExcCode(baseBook) : undefined;

        let validationAccountsMap = new Map<string, ValidationAccount>();

        for (const account of stockBook.getAccounts()) {
            if (account.isPermanent()) {
                validationAccountsMap.set(account.getName(), new ValidationAccount(account));
            }
        }

        const iterator = stockBook.getTransactions(BotService.getUncalculatedAccountsQuery(stockBook));
        while (iterator.hasNext()) {
            const transaction = iterator.next();
            const account = transaction.getCreditAccount().isPermanent() ? transaction.getCreditAccount() : transaction.getDebitAccount();
            let validationAccount = validationAccountsMap.get(account.getName());
            if (!validationAccount || validationAccount.needsRebuild() || validationAccount.hasUncalculatedResults()) {
                continue;
            }
            const contraAccount = transaction.getCreditAccount().isPermanent() ? transaction.getDebitAccount() : transaction.getCreditAccount();
            if (contraAccount.getName() == BUY_ACCOUNT_NAME) {
                validationAccount.pushUncheckedPurchase(transaction);
            }
            if (contraAccount.getName() == SELL_ACCOUNT_NAME) {
                validationAccount.pushUncheckedSale(transaction);
            }
        }

        let uncalculatedAccounts: Bkper.Account[] = [];

        for (const validationAccount of validationAccountsMap.values()) {
            if (validationAccount.needsRebuild() || validationAccount.hasUncalculatedResults()) {
                uncalculatedAccounts.push(validationAccount.getAccount());
                continue;
            }
            if (baseBookCurrency && validationAccount.hasExchangeRatesMissing(baseBookCurrency)) {
                uncalculatedAccounts.push(validationAccount.getAccount());
            }
        }

        return uncalculatedAccounts;
    }

    export function getUncalculatedAccountsQuery(stockBook: Bkper.Book): string {
        const closingDateIso = stockBook.getClosingDate();
        if (closingDateIso && closingDateIso !== '1900-00-00') {
            const closingDate = stockBook.parseDate(closingDateIso);
            let oppeningDate = new Date();
            oppeningDate.setTime(closingDate.getTime());
            oppeningDate.setDate(oppeningDate.getDate() + 1);
            return `after:${Utilities.formatDate(oppeningDate, stockBook.getTimeZone(), 'yyyy-MM-dd')} is:unchecked`;
        }
        return `is:unchecked`;
    }

    export function getBuyAccount(book: Bkper.Book): Bkper.Account {
        let account = book.getAccount(BUY_ACCOUNT_NAME);
        if (!account) {
            account = book.newAccount().setName(BUY_ACCOUNT_NAME).setType(BkperApp.AccountType.INCOMING).create();
        }
        return account;
    }

    export function getSellAccount(book: Bkper.Book): Bkper.Account {
        let account = book.getAccount(SELL_ACCOUNT_NAME);
        if (!account) {
            account = book.newAccount().setName(SELL_ACCOUNT_NAME).setType(BkperApp.AccountType.OUTGOING).create();
        }
        return account;
    }

    export function isAccountUncalculated(stockBookId: string, stockAccountId: string, forwardDate: string): boolean {

        const stockBook = BkperApp.getBook(stockBookId);
        const stockAccount = stockBook.getAccount(stockAccountId);

        let validationAccount = new ValidationAccount(stockAccount);

        const iterator = stockBook.getTransactions(`account:'${stockAccount.getName()}' before:${forwardDate}`);
        while (iterator.hasNext()) {
            if (validationAccount.hasUncalculatedResults()) {
                return false;
            }
            const batch = iterator.next();
            if (batch.isChecked()) {
                continue;
            }
            const contraAccount = batch.getCreditAccount().isPermanent() ? batch.getDebitAccount() : batch.getCreditAccount();
            if (contraAccount.getName() == BUY_ACCOUNT_NAME) {
                validationAccount.pushUncheckedPurchase(batch);
            }
            if (contraAccount.getName() == SELL_ACCOUNT_NAME) {
                validationAccount.pushUncheckedSale(batch);
            }
        }

        return validationAccount.hasUncalculatedResults() ? true : false;
    }

    export function hasPendingTasks(book: Bkper.Book): boolean {
        return (book.getBacklog().getCount() > 0) ? true : false;
    }

    export function getSupportAccount(book: Bkper.Book, stockAccount: StockAccount | Bkper.Account, suffix: string, accountType: Bkper.AccountType): Bkper.Account {
        const supportAccountName = `${stockAccount.getName()} ${suffix}`;
        let supportAccount = book.getAccount(supportAccountName);
        if (!supportAccount) {
            supportAccount = book.newAccount().setName(supportAccountName).setType(accountType);
            const groups = getGroupsByAccountSuffix(book, suffix);
            groups.forEach(group => supportAccount.addGroup(group));
            supportAccount.create();
        }
        return supportAccount;
    }

    export function getGroupsByAccountSuffix(book: Bkper.Book, suffix: string): Set<Bkper.Group> {
        // Map account names
        let accountNames = new Set<string>();
        book.getAccounts().forEach(account => {
            if (account.getName().endsWith(` ${suffix}`)) {
                accountNames.add(account.getName());
            }
        });
        // Map accounts by group
        let groups = new Set<Bkper.Group>();
        if (accountNames.size === 0) {
            return groups;
        }
        for (const group of book.getGroups()) {
            const groupAccounts = group.getAccounts();
            if (groupAccounts && groupAccounts.length > 0) {
                let shouldAddGroup = true;
                for (const accountName of accountNames) {
                    const account = book.getAccount(accountName);
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

    export function getTypeByAccountSuffix(book: Bkper.Book, suffix: string): Bkper.AccountType {
        // Map accounts by type
        let accountTypes = new Map<Bkper.AccountType, Bkper.Account[]>();
        for (const account of book.getAccounts()) {
            if (account.getName().endsWith(` ${suffix}`)) {
                let mappedAccounts = accountTypes.get(account.getType());
                if (mappedAccounts) {
                    mappedAccounts.push(account);
                } else {
                    accountTypes.set(account.getType(), [account]);
                }
            }
        }
        // Return most common type
        let maxOccurrencesType = BkperApp.AccountType.LIABILITY;
        let maxOccurrences = 1;
        for (const [accountType, accounts] of accountTypes.entries()) {
            if (accounts.length > maxOccurrences) {
                maxOccurrences = accounts.length;
                maxOccurrencesType = accountType;
            }
        }
        return maxOccurrencesType;
    }

    export function getRealizedExcAccountType(book: Bkper.Book): Bkper.AccountType {
        // Map exchange account names
        let excAccountNames = new Set<string>();
        book.getAccounts().forEach(account => {
            const excAccountProp = account.getProperty(EXC_ACCOUNT_PROP);
            if (excAccountProp) {
                excAccountNames.add(excAccountProp);
            }
            if (account.getName().startsWith('Exchange_')) {
                excAccountNames.add(account.getName());
            }
            if (account.getName().endsWith(` EXC`)) {
                excAccountNames.add(account.getName());
            }
        });
        // Map exchange accounts by type
        let excAccountTypes = new Map<Bkper.AccountType, Bkper.Account[]>();
        for (const accountName of excAccountNames) {
            const account = book.getAccount(accountName);
            if (account) {
                let mappedAccounts = excAccountTypes.get(account.getType());
                if (mappedAccounts) {
                    mappedAccounts.push(account);
                } else {
                    excAccountTypes.set(account.getType(), [account]);
                }
            }
        }
        // Return most common type
        let maxOccurrencesType = BkperApp.AccountType.LIABILITY;
        let maxOccurrences = 1;
        for (const [accountType, accounts] of excAccountTypes.entries()) {
            if (accounts.length > maxOccurrences) {
                maxOccurrences = accounts.length;
                maxOccurrencesType = accountType;
            }
        }
        return maxOccurrencesType;
    }

}
