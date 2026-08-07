import { Bkper, type Book } from 'bkper-js';
import { EXC_CODE_PROP } from '../constants.js';
import { Utils } from '../utils.js';

class BotService {
    async getConnectedBooks(book: Book): Promise<Set<Book>> {
        if (book.getVisibleProperties() == null) {
            return new Set<Book>();
        }
        const books = new Set<Book>();
        const bkper = new Bkper();

        // deprecated
        for (const key in book.getVisibleProperties()) {
            if (key.startsWith('exc') && key.endsWith('_book')) {
                books.add(await bkper.getBook(book.getVisibleProperties()[key]));
            }
        }

        // deprecated
        const excBooks = book.getProperty('exc_books');
        if (excBooks != null && excBooks.trim() != '') {
            const bookIds = excBooks.split(/[ ,]+/);
            for (const bookId of bookIds) {
                if (bookId != null && bookId.trim().length > 10) {
                    books.add(await bkper.getBook(bookId));
                }
            }
        }

        const collectionBooks =
            book.getCollection() != null ? book.getCollection()!.getBooks() : null;
        if (collectionBooks) {
            for (const collectionBook of collectionBooks) {
                if (
                    collectionBook.getId() != book.getId() &&
                    Utils.getExcCode(collectionBook) != null
                ) {
                    books.add(collectionBook);
                }
            }
        }

        return books;
    }

    getVisibleCollectionExcCodes(book: Book): Set<string> {
        const collection = book.getCollection();
        if (collection) {
            const excCodes = new Set<string>();
            for (const book of collection.getBooks()) {
                const bookExcCodeProp = book.getProperty(EXC_CODE_PROP, 'exchange_code');
                if (bookExcCodeProp) {
                    excCodes.add(bookExcCodeProp);
                }
            }
            return excCodes;
        }
        return new Set<string>();
    }

    async getBookConfiguredExcCodes(book: Book): Promise<Set<string>> {
        const excCodes = new Set<string>();
        const bookGroups = await book.getGroups();
        for (const group of bookGroups) {
            const groupExCodeProp = group.getProperty(EXC_CODE_PROP, 'exchange_code');
            if (groupExCodeProp) {
                excCodes.add(groupExCodeProp);
            }
        }
        return excCodes;
    }

    async hasPendingTasks(book: Book): Promise<boolean> {
        const bookBacklog = await book.getBacklog();
        const count = bookBacklog.getCount();
        return count && count > 0 ? true : false;
    }

    async getCollectionBooksWithErrors(book: Book): Promise<Set<string>> {
        const books = new Set<string>();
        const collection = book.getCollection();
        if (collection) {
            for (const book of collection.getBooks()) {
                const bookExcCode = Utils.getExcCode(book);
                if (bookExcCode) {
                    const hasErrors = await this.hasBotErrors(book);
                    if (hasErrors) {
                        books.add(bookExcCode);
                    }
                }
            }
        }
        return books;
    }

    private async hasBotErrors(book: Book): Promise<boolean> {
        const errorEvents = await book.listEvents({ onError: true, limit: 50 });
        return errorEvents.size() > 0 ? true : false;
    }
}

export const botService = new BotService();
