import { Bkper, Permission, type Book } from 'bkper-js';

const EXC_CODE_PROP = 'exc_code';
const EXC_BASE_PROP = 'exc_base';

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
                    this.getBaseCode(collectionBook) != null
                ) {
                    books.add(collectionBook);
                }
            }
        }

        return books;
    }

    getBooksExcCodesUserCanView(book: Book): Set<string> {
        const collection = book.getCollection();
        if (collection) {
            const excCodes = new Set<string>();
            for (const collectionBook of collection.getBooks()) {
                const bookExcCodeProp = collectionBook.getProperty(EXC_CODE_PROP, 'exchange_code');
                if (bookExcCodeProp) {
                    excCodes.add(bookExcCodeProp);
                }
            }
            return excCodes;
        }
        return new Set<string>();
    }

    canUserEditBook(book: Book): boolean {
        const permission = book.getPermission();
        return permission === Permission.OWNER || permission === Permission.EDITOR ? true : false;
    }

    async getBookConfiguredExcCodes(book: Book): Promise<Set<string>> {
        const excCodes = new Set<string>();
        for (const group of await book.getGroups()) {
            const groupExCodeProp = group.getProperty(EXC_CODE_PROP, 'exchange_code');
            if (groupExCodeProp) {
                excCodes.add(groupExCodeProp);
            }
        }
        return excCodes;
    }

    getBaseCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    isBaseBook(book: Book): boolean {
        if (book.getProperty(EXC_BASE_PROP)) {
            return true;
        } else {
            return false;
        }
    }

    hasBaseBookInCollection(book: Book): boolean {
        const collectionBooks =
            book.getCollection() != null ? book.getCollection()!.getBooks() : null;
        if (collectionBooks) {
            for (const collectionBook of collectionBooks) {
                if (this.isBaseBook(collectionBook)) {
                    return true;
                }
            }
        }
        return false;
    }

    async hasPendingTasks(book: Book): Promise<boolean> {
        return (await book.getBacklog()).getCount()! > 0 ? true : false;
    }

    getErrorText(values: unknown[]): string {
        return values.length > 1 ? 'books' : 'book';
    }

    async getCollectionBooksWithErrors(book: Book): Promise<Set<string>> {
        const collectionBooksWithErrors = new Set<string>();
        const collection = book.getCollection();
        if (collection) {
            for (const collectionBook of collection.getBooks()) {
                const bookExcCode = this.getBaseCode(collectionBook);
                if (bookExcCode && (await this.hasBotErrors(collectionBook))) {
                    collectionBooksWithErrors.add(bookExcCode);
                }
            }
        }
        return collectionBooksWithErrors;
    }

    private async hasBotErrors(book: Book): Promise<boolean> {
        const errorEvents = await book.listEvents({ onError: true, limit: 50 });
        return errorEvents.size() > 0 ? true : false;
    }
}

export const botService = new BotService();
