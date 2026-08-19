import { AccountType, type Account, type Book, type Group, type Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    EXC_BASE_PROP,
    EXC_CODE_PROP,
    LEGACY_REALIZED_DATE_PROP,
    REALIZED_DATE_PROP,
    STOCK_BOOK_PROP,
    STOCK_EXC_CODE_PROP,
    STOCK_FAIR_PROP,
    STOCK_HISTORICAL_PROP,
} from '../../shared/constants.js';
import { CalculationModel } from '../CalculationModel.js';

export class BotService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    isStockBook(book: Book): boolean {
        if (book.getProperty(STOCK_BOOK_PROP)) {
            return true;
        }
        if (book.getFractionDigits() == 0) {
            return true;
        }
        return false;
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
            if (this.getExcCode(connectedBook) === 'USD') {
                return connectedBook;
            }
        }
        return null;
    }

    getStockBook(book: Book): Book | null {
        const collection = book.getCollection();
        if (collection == null) {
            return null;
        }
        const connectedBooks = collection.getBooks();
        for (const connectedBook of connectedBooks) {
            if (connectedBook.getProperty(STOCK_BOOK_PROP)) {
                return connectedBook;
            }
            const fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits == 0) {
                return connectedBook;
            }
        }
        return null;
    }

    async getExchangeCode(account: Account): Promise<string | null> {
        const type = account.getType();
        if (type == AccountType.INCOMING || type == AccountType.OUTGOING) {
            return null;
        }
        const groups = await account.getGroups();
        if (groups != null) {
            for (const group of groups) {
                if (group == null) {
                    continue;
                }
                const excCode = group.getProperty(STOCK_EXC_CODE_PROP);
                if (excCode != null && excCode.trim() != '') {
                    return excCode;
                }
            }
        }
        return null;
    }

    async getFinancialBook(book: Book, excCode?: string): Promise<Book | null> {
        const collection = book.getCollection();
        if (collection == null) {
            return null;
        }
        const connectedBooks = collection.getBooks();
        for (const connectedBook of connectedBooks) {
            const excCodeConnectedBook = this.getExcCode(connectedBook);
            const fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits != 0 && excCode == excCodeConnectedBook) {
                return this.context.bkper.getBook(connectedBook.getId());
            }
        }
        return null;
    }

    async getStockAccount(stockTransaction: Transaction): Promise<Account | null | undefined> {
        if (await this.isSale(stockTransaction)) {
            return stockTransaction.getCreditAccount();
        }
        if (await this.isPurchase(stockTransaction)) {
            return stockTransaction.getDebitAccount();
        }
        return null;
    }

    getRealizedDateValue(account: Account): number | null {
        const legacyRealizedDate = account.getProperty(LEGACY_REALIZED_DATE_PROP);
        if (legacyRealizedDate) {
            return +legacyRealizedDate;
        }
        const realizedDate = account.getProperty(REALIZED_DATE_PROP);
        if (realizedDate) {
            return +realizedDate.replace(/-/g, '');
        }
        return null;
    }

    getStockExchangeCode(account: bkper.Account | null | undefined): string | null {
        if (
            account == null ||
            account.type == AccountType.INCOMING ||
            account.type == AccountType.OUTGOING
        ) {
            return null;
        }
        const groups = account.groups;
        if (groups != null) {
            for (const group of groups) {
                if (group == null) {
                    continue;
                }
                const stockExchange = group.properties![STOCK_EXC_CODE_PROP];
                if (stockExchange != null && stockExchange.trim() != '') {
                    return stockExchange;
                }
            }
        }
        return null;
    }

    async getStockExchangeGroup(account: Account | null | undefined): Promise<Group | null> {
        if (account == null || account.getType() != AccountType.ASSET) {
            return null;
        }
        const groups = await account.getGroups();
        if (groups != null) {
            for (const group of groups) {
                const stockExchange = group.getProperty(STOCK_EXC_CODE_PROP);
                if (stockExchange != null && stockExchange.trim() != '') {
                    return group;
                }
            }
        }
        return null;
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

    getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    isFlaggedAsHistorical(stockBook: Book): boolean {
        const stockHistoricalProp = stockBook.getProperty(STOCK_HISTORICAL_PROP);
        return stockHistoricalProp?.trim().toLowerCase() === 'true';
    }

    isFlaggedAsFair(stockBook: Book): boolean {
        const stockFairProp = stockBook.getProperty(STOCK_FAIR_PROP);
        return stockFairProp?.trim().toLowerCase() === 'true';
    }

    isHistoricalOnly(stockBook: Book): boolean {
        return this.isFlaggedAsHistorical(stockBook) && !this.isFlaggedAsFair(stockBook);
    }

    isFairOnly(stockBook: Book): boolean {
        return this.isFlaggedAsFair(stockBook) && !this.isFlaggedAsHistorical(stockBook);
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
}
