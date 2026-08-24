import type { Account, Book } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import {
    EXC_BASE_PROP,
    EXC_CODE_PROP,
    STOCK_BUY_ACCOUNT_NAME,
    STOCK_EXC_CODE_PROP,
    STOCK_SELL_ACCOUNT_NAME,
} from '../../shared/constants.js';
import { ValidationAccount } from './validation-account.js';

export interface MutationContext {
    portfolioBook: Book;
    portfolioAccount: Account;
    financialBook: Book;
    baseBook: Book;
}

export class BotService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async resolveMutationContext(
        portfolioBookId: string,
        portfolioAccountId: string
    ): Promise<MutationContext> {
        const portfolioBook = await this.context.bkper.getBook(portfolioBookId, true);
        const portfolioBookName = portfolioBook.getName() ?? portfolioBookId;

        const portfolioAccount = await portfolioBook.getAccount(portfolioAccountId);
        if (!portfolioAccount) {
            throw new HTTPException(400, {
                message: `Account ${portfolioAccountId} was not found in Book ${portfolioBookName}.`,
            });
        }

        const accountName = portfolioAccount.getName() ?? portfolioAccountId;

        if (!portfolioAccount.isPermanent()) {
            throw new HTTPException(400, {
                message: `Account ${accountName} is non-permanent in Book ${portfolioBookName}.`,
            });
        }

        if (portfolioAccount.isArchived()) {
            throw new HTTPException(400, {
                message: `Account ${accountName} is archived in Book ${portfolioBookName}.`,
            });
        }

        const accountExcCode = await this.getAccountExcCode(portfolioAccount);
        if (!accountExcCode) {
            throw new HTTPException(400, {
                message: `Account ${accountName} has no configured exchange code in Book ${portfolioBookName}.`,
            });
        }

        const financialBook = this.getFinancialBook(portfolioBook, accountExcCode);
        if (!financialBook) {
            throw new HTTPException(400, {
                message: `Financial Book for exchange code ${accountExcCode} was not found in the Collection of ${portfolioBookName}.`,
            });
        }

        const baseBook = this.getBaseBook(portfolioBook);
        if (!baseBook) {
            throw new HTTPException(400, {
                message: `Base Book was not found in the Collection of ${portfolioBookName}.`,
            });
        }

        return { portfolioBook, portfolioAccount, financialBook, baseBook };
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
            if (connectedBook.getProperty(EXC_CODE_PROP) == 'USD') {
                return connectedBook;
            }
        }
        return null;
    }

    private getFinancialBook(book: Book, excCode: string): Book | null {
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

    private async getAccountExcCode(account: Account): Promise<string | null> {
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
