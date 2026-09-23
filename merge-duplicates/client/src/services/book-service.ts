import { Bkper, type Book, type Config } from 'bkper-js';
import type { AuthProvider } from '../auth/auth-session';

export interface BookService {
    getBook(bookId: string): Promise<Book>;
}

export function createBkperClientConfig(auth: AuthProvider): Config {
    return {
        oauthTokenProvider: async () => auth.getAccessToken(),
        requestRetryHandler: async (status, _error, attempt) => {
            if (status === 403 && attempt === 1) {
                await auth.refresh();
            }
        },
    };
}

export function createBookService(auth: AuthProvider): BookService {
    const bkper = new Bkper(createBkperClientConfig(auth));
    return {
        getBook: bookId => bkper.getBook(bookId, true),
    };
}
