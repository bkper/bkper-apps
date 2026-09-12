import type { Book } from 'bkper-js';
import { EXC_CODE_PROP, STOCK_BOOK_PROP } from '../constants.js';

class BotService {
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
        }
        for (const connectedBook of connectedBooks) {
            const fractionDigits = connectedBook.getFractionDigits();
            if (fractionDigits == 0) {
                return connectedBook;
            }
        }
        return null;
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

    async hasPendingTasks(book: Book): Promise<boolean> {
        const backlog = await book.getBacklog();
        const count = backlog.getCount();
        return count !== undefined && count > 0;
    }

    getFinancialBook(book: Book, excCode: string): Book | null {
        if (!excCode.trim()) {
            return null;
        }
        const collection = book.getCollection();
        if (!collection) {
            return null;
        }
        for (const connectedBook of collection.getBooks()) {
            if (this.getExcCode(connectedBook) === excCode) {
                return connectedBook;
            }
        }
        return null;
    }

    private getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }
}

export const botService = new BotService();
