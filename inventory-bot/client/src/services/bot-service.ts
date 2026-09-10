import type { Book } from 'bkper-js';
import { EXC_CODE_PROP, INVENTORY_BOOK_PROP } from '../constants.js';
import { Utils } from '../utils.js';

class BotService {
    getInventoryBook(book: Book): Book | null {
        const collection = book.getCollection();
        if (!collection) {
            return null;
        }
        for (const connectedBook of collection.getBooks()) {
            if (connectedBook.getProperty(INVENTORY_BOOK_PROP)) {
                return connectedBook;
            }
            if (connectedBook.getFractionDigits() === 0) {
                return connectedBook;
            }
        }
        return null;
    }

    getFinancialBook(book: Book, excCode?: string | null): Book | null {
        const collection = book.getCollection();
        if (!collection || excCode == null) {
            return null;
        }
        for (const connectedBook of collection.getBooks()) {
            if (
                connectedBook.getFractionDigits() !== 0 &&
                this.getExcCode(connectedBook) === excCode
            ) {
                return connectedBook;
            }
        }
        return null;
    }

    getEditableFinancialBookExchangeCodes(book: Book, excCodes: Set<string>): Set<string> {
        const editableExcCodes = new Set<string>();
        for (const excCode of excCodes) {
            const financialBook = this.getFinancialBook(book, excCode);
            if (financialBook && Utils.canEditBook(financialBook)) {
                editableExcCodes.add(excCode);
            }
        }
        return editableExcCodes;
    }

    async hasPendingTasks(book: Book): Promise<boolean> {
        const backlog = await book.getBacklog();
        const count = backlog.getCount();
        return count !== undefined && count > 0;
    }

    private getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }
}

export const botService = new BotService();
