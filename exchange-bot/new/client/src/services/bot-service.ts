import type { Book } from 'bkper-js';
import { EXC_CODE_PROP } from '../constants.js';
import { Utils } from '../utils.js';
import { bookService } from './book-service.js';

class BotService {
    async getConnectedBooks(book: Book): Promise<Set<Book>> {
        if (book.getVisibleProperties() == null) {
            return new Set<Book>();
        }

        const legacyBookIds = this.getLegacyConnectedBookIds(book);

        const collectionBooks = book.getCollection()?.getBooks() ?? [];
        const collectionBooksById = new Map<string, Book>();

        for (const collectionBook of collectionBooks) {
            if (
                collectionBook.getId() != book.getId() &&
                Utils.getExcCode(collectionBook) != null &&
                !collectionBooksById.has(collectionBook.getId())
            ) {
                collectionBooksById.set(collectionBook.getId(), collectionBook);
            }
        }

        const legacyBooks = await Promise.all(
            Array.from(
                legacyBookIds,
                bookId => collectionBooksById.get(bookId) ?? bookService.loadBook(bookId)
            )
        );

        const books = new Set(legacyBooks);

        for (const [bookId, collectionBook] of collectionBooksById) {
            if (!legacyBookIds.has(bookId)) {
                books.add(collectionBook);
            }
        }

        return books;
    }

    private getLegacyConnectedBookIds(book: Book): Set<string> {
        const legacyBookIds = new Set<string>();
        // deprecated
        for (const key in book.getVisibleProperties()) {
            if (key.startsWith('exc') && key.endsWith('_book')) {
                const bookId = book.getVisibleProperties()[key];
                if (bookId) {
                    legacyBookIds.add(bookId);
                }
            }
        }
        // deprecated
        const excBooks = book.getProperty('exc_books');
        if (excBooks != null && excBooks.trim() != '') {
            const bookIds = excBooks.split(/[ ,]+/);
            for (const bookId of bookIds) {
                if (bookId != null && bookId.trim().length > 10) {
                    legacyBookIds.add(bookId);
                }
            }
        }
        return legacyBookIds;
    }

    getCollectionExcCodes(book: Book): Set<string> {
        const excCodes = new Set<string>();
        const collection = book.getCollection();
        if (collection) {
            for (const collectionBook of collection.getBooks()) {
                const bookExcCodeProp = collectionBook.getProperty(EXC_CODE_PROP, 'exchange_code');
                if (bookExcCodeProp) {
                    excCodes.add(bookExcCodeProp);
                }
            }
        }
        return excCodes;
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

    async getBooksWithPendingTasks(books: Set<Book>): Promise<Set<Book>> {
        const booksWithPendingTasks = new Set<Book>();
        for (const book of books) {
            const hasPendingTasks = await this.hasPendingTasks(book);
            if (hasPendingTasks) {
                booksWithPendingTasks.add(book);
            }
        }
        return booksWithPendingTasks;
    }

    private async hasPendingTasks(book: Book): Promise<boolean> {
        const bookBacklog = await book.getBacklog();
        const count = bookBacklog.getCount();
        return count && count > 0 ? true : false;
    }

    async getBooksWithEventErrors(books: Set<Book>): Promise<Set<Book>> {
        const booksWithEventErrors = new Set<Book>();
        for (const book of books) {
            const hasEventErrors = await this.hasEventErrors(book);
            if (hasEventErrors) {
                booksWithEventErrors.add(book);
            }
        }
        return booksWithEventErrors;
    }

    private async hasEventErrors(book: Book): Promise<boolean> {
        const errorEvents = await book.listEvents({ onError: true, limit: 1 });
        return errorEvents.size() > 0 ? true : false;
    }
}

export const botService = new BotService();
