import { Bkper, type Book } from 'bkper-js';

class BookService {
    /**
     * Loads a Book with its complete Account chart.
     *
     * @param bookId - The unique identifier of the Book to load.
     * @returns A promise that resolves to the Book with its Accounts loaded.
     */
    async loadBook(bookId: string): Promise<Book> {
        return new Bkper().getBook(bookId, true);
    }
}

export const bookService = new BookService();
