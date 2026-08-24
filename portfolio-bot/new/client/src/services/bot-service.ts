import type { Book } from 'bkper-js';
import { EXC_BASE_PROP, EXC_CODE_PROP, STOCK_BOOK_PROP } from '../constants.js';
import { Utils } from '../utils.js';

class BotService {
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

    getFinancialBook(book: Book, excCode?: string): Book | null {
        const collection = book.getCollection();
        if (collection == null) {
            return null;
        }
        const connectedBooks = collection.getBooks();
        for (const connectedBook of connectedBooks) {
            const bookExcCode = this.getExcCode(connectedBook);
            const fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits != 0 && excCode == bookExcCode) {
                return connectedBook;
            }
        }
        return null;
    }

    getBooksExcCodesUserCanEdit(book: Book): Set<string> {
        const excCodes = new Set<string>();
        const collection = book.getCollection();
        if (!collection) {
            return excCodes;
        }
        for (const connectedBook of collection.getBooks()) {
            const bookExcCode = this.getExcCode(connectedBook);
            if (bookExcCode && Utils.canEditBook(connectedBook)) {
                excCodes.add(bookExcCode);
            }
        }
        return excCodes;
    }

    private getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }
}

export const botService = new BotService();
