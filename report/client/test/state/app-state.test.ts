import { describe, expect, it, vi } from 'vitest';
import type { AuthSession, AuthSessionCallbacks } from '../../src/auth/auth-session';
import type { BookListItem, BookService } from '../../src/services/book-service';
import { AppState } from '../../src/state/app-state';
import type { ReportApi } from '../../src/state/reports';
import type { RoutePage } from '../../src/state/route';

const SAFE_ERROR = 'Could not load your Bkper data. Please reload and try again.';

function createPage(href: string) {
    const listeners = new Set<() => void>();
    const page: RoutePage = {
        location: { href },
        history: {
            state: null,
            pushState: (_data, _unused, url) => void (page.location.href = String(url)),
            replaceState: (_data, _unused, url) => void (page.location.href = String(url)),
        },
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
    };
    const goTo = (url: string) => {
        page.location.href = url;
        for (const listener of listeners) listener();
    };
    return { page, goTo };
}

function createAuth(): AuthSession {
    return {
        authenticatedFetch: async () => new Response(),
        getAccessToken: () => 'token-123',
        init: async () => undefined,
        login: () => undefined,
        refresh: async () => undefined,
    };
}

function createBookService(overrides: Partial<BookService> = {}): BookService {
    return {
        getCurrentUser: async () => ({ displayName: 'Ada Lovelace' }),
        listBooksDirect: async () => [{ id: 'book-1', name: 'Main Book' }],
        getBook: async bookId => ({ id: bookId, name: `Book ${bookId}` }),
        ...overrides,
    };
}

/** A report API that records what it is asked and never answers. */
function createReportApi() {
    const asked: string[] = [];
    const api: ReportApi = {
        suggestions: async bookId => {
            asked.push(`suggestions ${bookId}`);
            return [];
        },
        report: (bookId, body) => {
            asked.push(`report ${bookId} ${body.prompt ?? ''}`);
            return new Promise(() => undefined);
        },
    };
    return { api, asked };
}

/** An app at `href`, signed in once `signIn` runs. */
function createApp(href: string, bookService = createBookService()) {
    const { page, goTo } = createPage(href);
    const auth: { callbacks?: AuthSessionCallbacks } = {};
    const reportApi = createReportApi();
    const state = new AppState({
        page,
        embedded: false,
        language: 'en',
        createReportApi: () => reportApi.api,
        loadRenderer: async () => undefined,
        loadStrings: async () => undefined,
        createAuthSession: callbacks => {
            auth.callbacks = callbacks;
            return createAuth();
        },
        createBookService: () => bookService,
        logger: { error: () => undefined },
    });
    state.connect();
    const signIn = async () => auth.callbacks?.onLoginSuccess?.();
    return { state, page, goTo, signIn, auth, asked: reportApi.asked };
}

describe('AppState', () => {
    it('loads the Book picker after authentication succeeds', async () => {
        const { state, signIn } = createApp('https://report.bkper.app/');

        await signIn();

        expect(state.books.loading).toBe(false);
        expect(state.books.userDisplayName).toBe('Ada Lovelace');
        expect(state.books.books).toEqual([{ id: 'book-1', name: 'Main Book' }]);
    });

    it('shows a safe error when initial Bkper data cannot be loaded', async () => {
        const { state, signIn } = createApp(
            'https://report.bkper.app/',
            createBookService({
                getCurrentUser: async () => {
                    throw new Error('Sensitive client details');
                },
            })
        );

        await signIn();

        expect(state.books.loading).toBe(false);
        expect(state.books.appError).toBe(SAFE_ERROR);
    });

    it('shows the same safe error when authentication fails', () => {
        const { state, auth } = createApp('https://report.bkper.app/');

        auth.callbacks?.onError?.(new Error('Sensitive auth details'));

        expect(state.books.loading).toBe(false);
        expect(state.books.appError).toBe(SAFE_ERROR);
    });

    it('loads the selected Book when book is in the URL', async () => {
        const { state, signIn } = createApp('https://report.bkper.app/?book=book-1');

        await signIn();

        expect(state.route.bookId).toBe('book-1');
        expect(state.books.bookName).toBe('Book book-1');
    });

    it('shows a safe error when the selected Book cannot be loaded', async () => {
        const { state, signIn } = createApp(
            'https://report.bkper.app/?book=book-1',
            createBookService({
                getBook: async () => {
                    throw new Error('Sensitive Book details');
                },
            })
        );

        await signIn();

        expect(state.books.loading).toBe(false);
        expect(state.books.selectedBookError).toBe('Could not load this Book.');
    });

    it('selecting a Book writes it to the URL and loads it without reloading the page', async () => {
        const { state, page, signIn } = createApp('https://report.bkper.app/');
        await signIn();

        await state.books.select('book 1');

        expect(page.location.href).toBe('https://report.bkper.app/?book=book+1');
        expect(state.books.bookName).toBe('Book book 1');
    });

    it('going back to the Book list loads the list, even when the app opened on a Book', async () => {
        const { state, signIn } = createApp('https://report.bkper.app/?book=book-1');
        await signIn();

        await state.books.select(undefined);

        expect(state.route.bookId).toBeUndefined();
        expect(state.books.books).toEqual([{ id: 'book-1', name: 'Main Book' }]);
    });

    it('Back and Forward show the Book the URL selects', async () => {
        const { state, goTo, signIn } = createApp('https://report.bkper.app/');
        await signIn();

        goTo('https://report.bkper.app/?book=book-2');

        expect(state.route.bookId).toBe('book-2');
        await vi.waitFor(() => expect(state.books.bookName).toBe('Book book-2'));
    });

    it('shows the loading state until the selected Book answers', async () => {
        let answer: (book: BookListItem) => void = () => undefined;
        const { state, signIn } = createApp(
            'https://report.bkper.app/',
            createBookService({
                getBook: () => new Promise(resolve => (answer = resolve)),
            })
        );
        await signIn();

        const selecting = state.books.select('book-1');
        expect(state.books.loading).toBe(true);
        answer({ id: 'book-1', name: 'Main Book' });
        await selecting;

        expect(state.books.loading).toBe(false);
    });

    it('keeps the latest selection when an earlier Book answers last', async () => {
        const answers = new Map<string, (book: BookListItem) => void>();
        const { state, signIn } = createApp(
            'https://report.bkper.app/',
            createBookService({
                getBook: bookId => new Promise(resolve => answers.set(bookId, resolve)),
            })
        );
        await signIn();

        const first = state.books.select('book-1');
        const second = state.books.select('book-2');
        answers.get('book-2')?.({ id: 'book-2', name: 'Second' });
        await second;
        answers.get('book-1')?.({ id: 'book-1', name: 'First' });
        await first;

        expect(state.books.bookName).toBe('Second');
        expect(state.books.loading).toBe(false);
    });

    it('opens the report the URL asks for, with the suggestions, once signed in', async () => {
        const { state, signIn, asked } = createApp(
            'https://report.bkper.app/?book=book-1&q=despesas%202011'
        );
        expect(asked).toEqual([]);

        await signIn();

        expect(state.reports.text).toBe('despesas 2011');
        expect(asked).toEqual(['suggestions book-1', 'report book-1 despesas 2011']);
    });

    it('opening a Book starts its reports over', async () => {
        const { state, signIn, asked, page } = createApp('https://report.bkper.app/?q=x');
        await signIn();

        state.select('book-2');

        expect(page.location.href).toBe('https://report.bkper.app/?book=book-2');
        expect(asked).toEqual(['suggestions book-2']);
    });

    it('Back and Forward open the report the URL asks for', async () => {
        const { state, goTo, signIn, asked } = createApp('https://report.bkper.app/');
        await signIn();

        goTo('https://report.bkper.app/?book=book-3&q=net%20result');

        expect(state.reports.text).toBe('net result');
        expect(asked).toEqual(['suggestions book-3', 'report book-3 net result']);
    });

    it('going back to the Book list while a Book loads shows the list', async () => {
        const { state, signIn } = createApp(
            'https://report.bkper.app/',
            createBookService({ getBook: () => new Promise(() => undefined) })
        );
        await signIn();

        state.select('book-1');
        state.select(undefined);

        expect(state.books.loading).toBe(false);
        expect(state.books.books).toEqual([{ id: 'book-1', name: 'Main Book' }]);
    });

    it('preloads the report renderer once, and says so when it cannot load', async () => {
        const { page } = createPage('https://report.bkper.app/?book=book-1');
        let loads = 0;
        const state = new AppState({
            page,
            embedded: false,
            language: 'en',
            createAuthSession: () => createAuth(),
            createBookService: () => createBookService(),
            createReportApi: () => createReportApi().api,
            loadRenderer: async () => {
                loads++;
                throw new Error('Offline');
            },
            loadStrings: async () => undefined,
            logger: { error: () => undefined },
        });

        state.connect();
        state.connect();

        await vi.waitFor(() => expect(state.reports.notice).toBe('error_unexpected'));
        expect(loads).toBe(1);
    });

    it('shows the interface in its language once its strings load, else in English', async () => {
        const { page } = createPage('https://report.bkper.app/');
        const loaded: string[] = [];
        const errors: unknown[] = [];
        const app = (loadStrings: (lang: string) => Promise<void>) =>
            new AppState({
                page,
                embedded: false,
                language: 'ja',
                createAuthSession: () => createAuth(),
                createBookService: () => createBookService(),
                createReportApi: () => createReportApi().api,
                loadRenderer: async () => undefined,
                loadStrings,
                logger: { error: (...args: unknown[]) => errors.push(args) },
            });

        const state = app(async lang => void loaded.push(lang));
        expect(state.strings.language).toBe('en');
        state.connect();
        await vi.waitFor(() => expect(state.strings.language).toBe('ja'));
        expect(loaded).toEqual(['ja']);
        expect(state.reports.language).toBe('ja');

        const offline = app(async () => {
            throw new Error('Offline');
        });
        offline.connect();
        await vi.waitFor(() => expect(errors).toHaveLength(1));
        expect(offline.strings.language).toBe('en');
    });
});
