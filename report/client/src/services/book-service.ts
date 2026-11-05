import { Bkper, type Config } from 'bkper-js';
import type { AuthProvider } from '../auth/auth-session';

export interface UserProfile {
    displayName: string;
}

export interface BookListItem {
    id: string;
    name: string;
}

export interface BrowserBkperUser {
    getName(): string | undefined;
    getFullName(): string | undefined;
}

export interface BrowserBkperBook {
    getId(): string;
    getName(): string | undefined;
}

export interface BrowserBkperClient {
    getUser(): Promise<BrowserBkperUser>;
    getBooks(): Promise<BrowserBkperBook[]>;
    getBook(id: string): Promise<BrowserBkperBook>;
}

export interface BookService {
    getCurrentUser(): Promise<UserProfile>;
    listBooksDirect(): Promise<BookListItem[]>;
    getBook(bookId: string): Promise<BookListItem>;
}

export interface BookServiceOptions {
    auth: AuthProvider;
    bkper?: BrowserBkperClient;
}

const UNTITLED_BOOK_NAME = 'Untitled book';

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
        async getCurrentUser(): Promise<UserProfile> {
            const user = await bkper.getUser();
            return {
                displayName: user.getName() || user.getFullName() || 'there',
            };
        },

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
    return {
        id: book.getId(),
        name: book.getName() ?? UNTITLED_BOOK_NAME,
    };
}
