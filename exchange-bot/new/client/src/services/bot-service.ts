import type { Book } from 'bkper-js';
import { EXC_CODE_PROP } from '../constants.js';
import { Utils } from '../utils.js';
import { bkperService } from './bkper-service.js';
import { runRequestsInBatches } from './request-batch.js';

class BotService {
    async getConnectedBooks(book: Book): Promise<Set<Book>> {
        if (book.getVisibleProperties() == null) {
            return new Set<Book>();
        }

        // Connected books in the Collection
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

        // Connected books by deprecated methods
        const legacyBookIds = this.getLegacyConnectedBookIds(book);
        const legacyLoadedBooks = await runRequestsInBatches(
            Array.from(legacyBookIds).filter(id => !collectionBooksById.has(id)),
            async id => await bkperService.loadBook(id)
        );
        const loadedBooksById = new Map(legacyLoadedBooks.map(b => [b.getId(), b]));

        const connectedBooks = new Set<Book>();

        // Add legacy first to preserve behavior
        for (const legacyBookId of legacyBookIds) {
            const legacyBook =
                collectionBooksById.get(legacyBookId) ?? loadedBooksById.get(legacyBookId);
            if (legacyBook) {
                connectedBooks.add(legacyBook);
            }
        }

        // Add Collection books after
        for (const collectionBook of collectionBooksById.values()) {
            connectedBooks.add(collectionBook);
        }

        return connectedBooks;
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
        const pendingBooks = await runRequestsInBatches(books, async book => {
            const hasPendingTasks = await this.hasPendingTasks(book);
            return hasPendingTasks ? book : null;
        });
        return new Set(pendingBooks.filter(book => book !== null));
    }

    private async hasPendingTasks(book: Book): Promise<boolean> {
        const bookBacklog = await book.getBacklog();
        const count = bookBacklog.getCount();
        return count && count > 0 ? true : false;
    }

    async getBooksWithEventErrors(books: Set<Book>): Promise<Set<Book>> {
        const errorBooks = await runRequestsInBatches(books, async book => {
            const hasEventErrors = await this.hasEventErrors(book);
            return hasEventErrors ? book : null;
        });
        return new Set(errorBooks.filter(book => book !== null));
    }

    private async hasEventErrors(book: Book): Promise<boolean> {
        const errorEvents = await book.listEvents({ onError: true, limit: 1 });
        return errorEvents.size() > 0 ? true : false;
    }
}

export const botService = new BotService();
