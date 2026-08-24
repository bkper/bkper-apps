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

    getFinancialBooks(book: Book): Map<string, Book> {
        const financialBooks = new Map<string, Book>();
        const collection = book.getCollection();
        if (collection == null) {
            return financialBooks;
        }
        for (const connectedBook of collection.getBooks()) {
            const bookExcCode = this.getExcCode(connectedBook);
            const fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits != 0 && bookExcCode && !financialBooks.has(bookExcCode)) {
                financialBooks.set(bookExcCode, connectedBook);
            }
        }
        return financialBooks;
    }

    areAllCollectionBooksOpenAndUnlocked(book: Book): boolean {
        const collection = book.getCollection();
        if (!collection) {
            return false;
        }
        for (const connectedBook of collection.getBooks()) {
            const lockDate = connectedBook.getLockDate();
            const closingDate = connectedBook.getClosingDate();
            const isUnlocked = !lockDate || lockDate === '1900-00-00';
            const isOpen = !closingDate || closingDate === '1900-00-00';
            if (!isUnlocked || !isOpen) {
                return false;
            }
        }
        return true;
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
