import { Bkper, type Config } from 'bkper-js';
import type { AuthProvider } from '../auth/auth-session';

export interface BookListItem {
    id: string;
    /** Empty for a Book without a name, which the interface names in its language. */
    name: string;
    /** When the Book last changed, in milliseconds. */
    lastUpdateMs?: number;
}

export interface BrowserBkperBook {
    getId(): string;
    getName(): string | undefined;
    getLastUpdateMs(): number | undefined;
}

export interface BrowserBkperClient {
    getBooks(): Promise<BrowserBkperBook[]>;
    getBook(id: string): Promise<BrowserBkperBook>;
}

export interface BookService {
    listBooksDirect(): Promise<BookListItem[]>;
    getBook(bookId: string): Promise<BookListItem>;
}

export interface BookServiceOptions {
    auth: AuthProvider;
    bkper?: BrowserBkperClient;
}

export function createBkperClientConfig(auth: AuthProvider): Config {
    return {
        oauthTokenProvider: async () => auth.getAccessToken(),
        requestRetryHandler: async (status, _error, attempt) => {
            if (status === 401 && attempt === 1) {
                await auth.refresh();
            }
        },
    };
}

export function createBookService(options: BookServiceOptions): BookService {
    const bkper = options.bkper ?? new Bkper(createBkperClientConfig(options.auth));

    return {
        async listBooksDirect(): Promise<BookListItem[]> {
            const books = await bkper.getBooks();
            return books.map(toBookListItem);
        },

        async getBook(bookId: string): Promise<BookListItem> {
            return toBookListItem(await bkper.getBook(bookId));
        },
    };
}

function toBookListItem(book: BrowserBkperBook): BookListItem {
    const lastUpdateMs = book.getLastUpdateMs();
    return {
        id: book.getId(),
        name: book.getName() ?? '',
        ...(lastUpdateMs === undefined ? {} : { lastUpdateMs }),
    };
}
