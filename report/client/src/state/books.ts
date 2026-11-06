import type { StringKey } from 'report-shared/strings';
import type { BookListItem, BookService } from '../services/book-service';
import type { Route } from './route';
import { reactive, Store } from './store';

/**
 * The Books whose names have every word of `filter`, ignoring case and accents, in their order;
 * the first ones without a filter. At most `limit`.
 */
export function findBooks(books: BookListItem[], filter: string, limit: number): BookListItem[] {
    const words = searchable(filter).split(/\s+/).filter(Boolean);
    const found = words.length
        ? books.filter(book => {
              const name = searchable(book.name);
              return words.every(word => name.includes(word));
          })
        : books;
    return found.slice(0, limit);
}

function searchable(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** The Books changed most recently first; Books without a date last. */
function byRecency(books: BookListItem[]): BookListItem[] {
    return [...books].sort((a, b) => (b.lastUpdateMs ?? 0) - (a.lastUpdateMs ?? 0));
}

/**
 * The signed-in person's Books and the selected Book. The route says which Book is
 * selected; `select` changes it and loads what it shows. Errors are string keys, safe to show.
 */
export class Books extends Store {
    @reactive loading = true;
    @reactive appError: StringKey | null = null;
    /** The person's Books, the most recently changed first. */
    @reactive books: BookListItem[] = [];
    @reactive bookName: string | null = null;
    @reactive selectedBookError: StringKey | null = null;
    private listed = false;

    constructor(
        private readonly bookService: BookService,
        private readonly route: Route,
        private readonly logger: Pick<Console, 'error'>
    ) {
        super();
    }

    /** Load what the URL selects, once signed in. */
    async load(): Promise<void> {
        this.loading = true;
        this.appError = null;
        try {
            await this.show();
        } catch (error) {
            this.fail('Error loading data:', error);
        } finally {
            this.loading = false;
        }
    }

    /** Select a Book, or none for the Book list, and show it. */
    async select(bookId: string | undefined): Promise<void> {
        this.route.select(bookId);
        try {
            await this.show();
        } catch (error) {
            this.fail('Error loading data:', error);
        }
    }

    /** Nothing can load, such as when authentication fails. Shows a safe message, never the error. */
    fail(message: string, error: unknown): void {
        this.logger.error(message, error);
        this.loading = false;
        this.appError = 'error_load_data';
    }

    /** Load what the route selects, showing the loading state until the latest selection answers. */
    private async show(): Promise<void> {
        const bookId = this.route.bookId;
        if (!bookId && this.listed) {
            // The list is loaded; a Book still loading must not keep it waiting.
            this.loading = false;
            return;
        }
        this.loading = true;
        try {
            if (bookId) return await this.loadBook(bookId);
            this.books = byRecency(await this.bookService.listBooksDirect());
            this.listed = true;
        } finally {
            if (this.route.bookId === bookId) this.loading = false;
        }
    }

    private async loadBook(bookId: string): Promise<void> {
        this.selectedBookError = null;
        this.bookName = null;
        try {
            const book = await this.bookService.getBook(bookId);
            // Another Book may have been selected meanwhile; it shows its own.
            if (this.route.bookId !== bookId) return;
            this.bookName = book.name;
        } catch (error) {
            if (this.route.bookId !== bookId) return;
            this.logger.error('Error loading book:', error);
            this.selectedBookError = 'error_book_load';
        }
    }
}
