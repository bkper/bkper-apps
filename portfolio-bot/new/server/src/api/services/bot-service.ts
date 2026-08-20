import type { Account, Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    EXC_BASE_PROP,
    EXC_CODE_PROP,
    STOCK_BUY_ACCOUNT_NAME,
    STOCK_SELL_ACCOUNT_NAME,
} from '../../shared/constants.js';
import { ValidationAccount } from './validation-account.js';

export class BotService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

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
            if (this.getExcCode(connectedBook) == 'USD') {
                return connectedBook;
            }
        }
        return null;
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
            const closingDate = stockBook.parseDate(closingDateIso);
            const openingDate = new Date();
            openingDate.setTime(closingDate.getTime());
            openingDate.setDate(openingDate.getDate() + 1);
            return `after:${this.formatIsoDate(openingDate, stockBook.getTimeZone())} is:unchecked`;
        }
        return 'is:unchecked';
    }

    private getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    private formatIsoDate(date: Date, timeZone?: string): string {
        const parts = new Intl.DateTimeFormat('en-US', {
            calendar: 'gregory',
            day: '2-digit',
            month: '2-digit',
            numberingSystem: 'latn',
            timeZone,
            year: 'numeric',
        }).formatToParts(date);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        const day = parts.find(part => part.type === 'day')?.value;
        if (!year || !month || !day) {
            throw new Error('The opening date could not be determined');
        }
        return `${year}-${month}-${day}`;
    }
}
