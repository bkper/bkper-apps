import { Bkper, type Book } from 'bkper-js';
import type { AuthProvider } from '../auth/auth-session';

export interface BookService {
    getBook(bookId: string): Promise<Book>;
}

export function createBookService(auth: AuthProvider): BookService {
    const bkper = new Bkper({
        oauthTokenProvider: async () => auth.getAccessToken(),
    });
    return {
        getBook: bookId => bkper.getBook(bookId),
    };
}
