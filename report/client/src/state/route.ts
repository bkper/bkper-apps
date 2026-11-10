import { stateFromUrlValue } from 'report-shared/url-state';
import { reactive, Store } from './store';

/** The URL query parameter that selects the Book, as the Book menu opens the app. */
const BOOK_PARAM = 'book';
/** The URL query parameter that holds the report request, so a report can be reloaded or shared. */
const PROMPT_PARAM = 'q';
/**
 * The URL query parameter that holds the report's state (`report-shared/url-state`),
 * as the Book menu opens the app with the state Bkper keeps in the Book's URL (`${app.state}`).
 */
const STATE_PARAM = 'state';
/**
 * The URL query parameter that holds the query the Book shows its transactions with, as the Book
 * menu opens the app (`${transactions.query}`), so the report follows what the Book shows.
 */
const BOOK_QUERY_PARAM = 'bookQuery';
/** Expressions Bkper leaves unreplaced when the Book shows no query: no query. */
const BOOK_QUERY_EXPRESSIONS: ReadonlySet<string> = new Set([
    '${transactions.query}',
    '${query}',
    '{query}',
]);

/** The page the app runs in: its URL and session history. The browser's `window`, or a double in tests. */
export interface RoutePage {
    readonly location: { href: string };
    readonly history: {
        readonly state: unknown;
        pushState(data: unknown, unused: string, url: string | URL): void;
        replaceState(data: unknown, unused: string, url: string | URL): void;
    };
    addEventListener(type: 'popstate', listener: () => void): void;
    removeEventListener(type: 'popstate', listener: () => void): void;
}

/**
 * The person went back or forward, or Bkper changed the app's URL, to one that selects `bookId`,
 * or the Book list without one, and asks for `prompt` (empty for none) or the report of `state`,
 * with the Book showing `query`.
 */
export class Navigation extends Event {
    constructor(
        readonly bookId: string | undefined,
        readonly prompt: string,
        readonly state?: string,
        readonly query?: string
    ) {
        super('navigate');
    }
}

/** The open Book now shows its transactions with another `query`, which the report follows. */
export class BookQueryChange extends Event {
    constructor(readonly query: string) {
        super('book-query');
    }
}

/**
 * The app's one binding to the page URL: the selected Book, the report request and the report's
 * state. Nothing else reads or writes its path, query or history.
 *
 * Standalone, each Book selection is a history entry, so Back and Forward work. Embedded in a
 * Book, a selection only replaces the URL, so the Book's own Back button stays the Book's. The
 * request always replaces the URL: it changes with every keystroke. Fires a `Navigation` when
 * the person goes back or forward.
 */
export class Route extends Store {
    @reactive bookId?: string;
    @reactive prompt = '';
    /** The report's state, unread; none when missing, empty or the unreplaced expression. */
    @reactive state?: string;
    /**
     * The Book's query last followed, as Bkper put it in the URL; none when missing, empty or
     * an unreplaced expression.
     */
    @reactive bookQuery?: string;

    constructor(
        private readonly page: RoutePage,
        private readonly embedded: boolean
    ) {
        super();
        this.bookId = bookIdFrom(page.location.href);
        this.prompt = promptFrom(page.location.href);
        this.state = stateFrom(page.location.href);
        this.bookQuery = bookQueryFrom(page.location.href);
    }

    connect(): void {
        this.page.addEventListener('popstate', this.onPopState);
    }
    disconnect(): void {
        this.page.removeEventListener('popstate', this.onPopState);
    }

    /**
     * Select a Book, or none for the Book list, and keep it in the URL. Another Book drops the
     * request, its state and the query of the Book left.
     */
    select(bookId: string | undefined): void {
        this.bookId = bookId;
        // Compare the value, not the URL text: setting a parameter re-encodes the whole query.
        if (bookIdFrom(this.page.location.href) === bookId) return;
        this.prompt = '';
        this.state = undefined;
        this.bookQuery = undefined;
        const url = new URL(this.page.location.href);
        if (bookId) url.searchParams.set(BOOK_PARAM, bookId);
        else url.searchParams.delete(BOOK_PARAM);
        url.searchParams.delete(PROMPT_PARAM);
        url.searchParams.delete(STATE_PARAM);
        url.searchParams.delete(BOOK_QUERY_PARAM);
        if (this.embedded) this.page.history.replaceState(this.page.history.state, '', url);
        else this.page.history.pushState(null, '', url);
    }

    /** Keep the report request in the URL, replacing it: typing adds no history entries. */
    setPrompt(prompt: string): void {
        this.prompt = prompt;
        if (promptFrom(this.page.location.href) === prompt) return;
        const url = new URL(this.page.location.href);
        if (prompt) url.searchParams.set(PROMPT_PARAM, prompt);
        else url.searchParams.delete(PROMPT_PARAM);
        this.page.history.replaceState(this.page.history.state, '', url);
    }

    /** Keep the state of the report on screen in the URL, replacing it; none drops it. */
    setState(state: string | undefined): void {
        this.state = state;
        if (stateFrom(this.page.location.href) === state) return;
        const url = new URL(this.page.location.href);
        if (state) url.searchParams.set(STATE_PARAM, state);
        else url.searchParams.delete(STATE_PARAM);
        this.page.history.replaceState(this.page.history.state, '', url);
    }

    /**
     * Bkper changed the app's URL (`bkper:app-url-changed`), such as for Back in the Book or when
     * the Book shows another query: take its Book, state and query, replacing the URL. Fires a
     * `Navigation` when its Book or state changes; else a {@link BookQueryChange} when it has a
     * query other than the one last followed. A URL that repeats them, such as after the app
     * sent its state, or a query cleared, keeps the report on screen.
     */
    follow(href: string): void {
        const bookId = bookIdFrom(href);
        const state = stateFrom(href);
        const query = bookQueryFrom(href);
        const navigates = bookId !== this.bookId || (state !== undefined && state !== this.state);
        if (!navigates && query === this.bookQuery) return;
        this.bookQuery = query;
        const url = new URL(this.page.location.href);
        if (query) url.searchParams.set(BOOK_QUERY_PARAM, query);
        else url.searchParams.delete(BOOK_QUERY_PARAM);
        if (navigates) {
            this.bookId = bookId;
            this.prompt = '';
            this.state = state;
            if (bookId) url.searchParams.set(BOOK_PARAM, bookId);
            else url.searchParams.delete(BOOK_PARAM);
            url.searchParams.delete(PROMPT_PARAM);
            if (state) url.searchParams.set(STATE_PARAM, state);
            else url.searchParams.delete(STATE_PARAM);
        }
        this.page.history.replaceState(this.page.history.state, '', url);
        if (navigates) this.dispatchEvent(new Navigation(bookId, '', state, query));
        else if (query) this.dispatchEvent(new BookQueryChange(query));
    }

    private readonly onPopState = () => {
        const href = this.page.location.href;
        this.prompt = promptFrom(href);
        this.state = stateFrom(href);
        this.bookQuery = bookQueryFrom(href);
        this.dispatchEvent(
            new Navigation(bookIdFrom(href), this.prompt, this.state, this.bookQuery)
        );
    };
}

function bookIdFrom(href: string): string | undefined {
    return new URL(href).searchParams.get(BOOK_PARAM) ?? undefined;
}

function promptFrom(href: string): string {
    return new URL(href).searchParams.get(PROMPT_PARAM) ?? '';
}

function stateFrom(href: string): string | undefined {
    return stateFromUrlValue(new URL(href).searchParams.get(STATE_PARAM));
}

function bookQueryFrom(href: string): string | undefined {
    const query = new URL(href).searchParams.get(BOOK_QUERY_PARAM)?.trim();
    return query && !BOOK_QUERY_EXPRESSIONS.has(query) ? query : undefined;
}
