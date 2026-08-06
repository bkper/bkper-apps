import { Bkper, type Book } from 'bkper-js';

class BookService {
    async loadBook(bookId: string): Promise<Book> {
        return new Bkper().getBook(bookId);
    }
}

export const bookService = new BookService();
