import type { Account, Book } from 'bkper-js';
import {
    EXC_BASE_PROP,
    EXC_CODE_PROP,
    STOCK_BUY_ACCOUNT_NAME,
    STOCK_EXC_CODE_PROP,
    STOCK_SELL_ACCOUNT_NAME,
} from '../../shared/constants.js';
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

    getFinancialBook(book: Book, excCode: string): Book | null {
        const collection = book.getCollection();
        if (!collection) {
            return null;
        }
        for (const connectedBook of collection.getBooks()) {
            if (
                connectedBook.getFractionDigits() != 0 &&
                this.getBookExcCode(connectedBook) == excCode
            ) {
                return connectedBook;
            }
        }
        return null;
    }

    async getUncalculatedAccounts(stockBook: Book, baseBook?: Book): Promise<Account[]> {
        const baseBookCurrency = baseBook ? this.getBookExcCode(baseBook) : undefined;

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

    private getBookExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
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

    private getNextIsoDate(dateIso: string): string {
        const [year, month, day] = dateIso.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() + 1);
        return date.toISOString().slice(0, 10);
    }
}
