import { Bkper, type Book } from 'bkper-js';

class BookService {
    /**
     * Loads a Book, optionally with its complete Account chart.
     *
     * @param bookId - The unique identifier of the Book to load.
     * @param loadAccounts - Whether to include the Book's Accounts and Groups.
     * @returns A promise that resolves to the requested Book.
     */
    async loadBook(bookId: string, loadAccounts = false): Promise<Book> {
        return new Bkper().getBook(bookId, loadAccounts);
    }
}

export const bookService = new BookService();
