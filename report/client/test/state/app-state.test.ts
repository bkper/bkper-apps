import { decodeReportState, encodeReportState } from 'report-shared/report-state';
import { describe, expect, it, vi } from 'vitest';
import type {
    BookProblem,
    ReportRequest,
    ReportResponse,
    Suggestion,
    SuggestionsResponse,
} from '../../src/api/app-api';
import type { AuthSession, AuthSessionCallbacks } from '../../src/auth/auth-session';
import type { BookListItem, BookService } from '../../src/services/book-service';
import { AppState } from '../../src/state/app-state';
import { SELECT_TEXT, type ReportApi } from '../../src/state/reports';
import type { HostPage } from '../../src/state/book-host';
import type { RoutePage } from '../../src/state/route';
import type { SavedReportsApi } from '../../src/state/saved-reports';
import type { BookNamesApi } from '../../src/state/book-names';
import { CACHE_MS } from '../../src/state/cache-window';

const SAVED = { id: 'a'.repeat(64), prompt: 'Expenses this year' };
const WRITE = { list: true, save: true, remove: true, move: true };
function createShelfApi() {
    const loaded: string[] = [];
    const saved: { book: string; prompt: string }[] = [];
    const api: SavedReportsApi = {
        savedReports: async book => {
            loaded.push(book);
            return { reports: [SAVED], capabilities: WRITE };
        },
        saveReport: async (book, body) => {
            saved.push({ book, prompt: body.prompt });
            return { id: 'b'.repeat(64), prompt: body.prompt };
        },
        removeReport: async () => undefined,
        moveReport: async () => ({ reports: [SAVED], capabilities: WRITE }),
    };
    return { api, loaded, saved };
}

const SAFE_ERROR = 'error_load_data';

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
            return { suggestions: [] };
        },
        report: (bookId, body) => {
            asked.push(`report ${bookId} ${body.prompt ?? ''}`);
            return new Promise(() => undefined);
        },
    };
    return { api, asked };
}

/** A names API that records the Books it is asked for and answers with one name each. */
function createNamesApi() {
    const asked: string[] = [];
    const api: BookNamesApi = {
        names: async bookId => {
            asked.push(bookId);
            return [{ id: `a-${bookId}`, name: `Food of ${bookId}`, kind: 'account', root: 'g' }];
        },
    };
    return { api, asked };
}

/** An app at `href`, signed in once `signIn` runs. */
function createApp(href: string, bookService = createBookService()) {
    const { page, goTo } = createPage(href);
    const auth: { callbacks?: AuthSessionCallbacks } = {};
    const reportApi = createReportApi();
    const shelfApi = createShelfApi();
    const namesApi = createNamesApi();
    const clock = { now: 1_000_000 };
    const state = new AppState({
        page,
        embedded: false,
        language: 'en',
        createReportApi: () => reportApi.api,
        createSavedReportsApi: () => shelfApi.api,
        createBookNamesApi: () => namesApi.api,
        now: () => clock.now,
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
    return { state, page, goTo, signIn, auth, asked: reportApi.asked, shelfApi, namesApi, clock };
}

describe('AppState', () => {
    it('starts shelf loading only after auth without waiting for Book details or reports', async () => {
        const { state, signIn, shelfApi, goTo, asked } = createApp(
            'https://report.bkper.app/?book=book-1&q=expenses%20this%20year',
            createBookService({ getBook: () => new Promise(() => undefined) })
        );
        expect(shelfApi.loaded).toEqual([]);
        void signIn();
        await vi.waitFor(() => expect(state.savedReports.items).toEqual([SAVED]));
        expect(shelfApi.loaded).toEqual(['book-1']);
        expect(asked).toEqual(['suggestions book-1', 'report book-1 expenses this year']);
        state.openSavedReport(SAVED.id);
        state.openSavedReport(SAVED.id);
        // The typed request differs in casing, so the saved text is asked once, by itself.
        expect(asked.slice(-2)).toEqual([
            'report book-1 expenses this year',
            'report book-1 Expenses this year',
        ]);
        state.select('book-2');
        expect(state.savedReports.bookId).toBe('book-2');
        expect(state.savedReports.items).toEqual([]);
        await vi.waitFor(() => expect(shelfApi.loaded).toEqual(['book-1', 'book-2']));
        goTo('https://report.bkper.app/?book=book-3');
        expect(state.savedReports.bookId).toBe('book-3');
        state.select(undefined);
        expect(state.savedReports.bookId).toBeUndefined();
        expect(state.savedReports.items).toEqual([]);
    });

    it('loads the Book’s names after auth, per Book, and asks again only after a minute of typing', async () => {
        const { state, signIn, namesApi, goTo, clock } = createApp(
            'https://report.bkper.app/?book=book-1',
            createBookService({ getBook: () => new Promise(() => undefined) })
        );
        expect(namesApi.asked).toEqual([]);
        void signIn();
        expect(namesApi.asked).toEqual(['book-1']);
        await state.names.loaded;
        const offered = (text: string) =>
            state.names.complete(text, text.length).map(({ text }) => text);
        expect(offered('expenses fo')).toEqual(['Food of book-1']);

        for (const text of ['e', 'ex', 'expenses', 'expenses fo', 'expenses foo']) {
            state.reports.input(text);
            offered(text);
        }
        expect(namesApi.asked).toEqual(['book-1']);
        clock.now += CACHE_MS;
        state.reports.input('expenses food');
        state.reports.input('expenses food ');
        expect(namesApi.asked).toEqual(['book-1', 'book-1']);

        state.select('book-2');
        expect(state.names.bookId).toBe('book-2');
        expect(offered('fo')).toEqual([]);
        await state.names.loaded;
        expect(offered('fo')).toEqual(['Food of book-2']);
        goTo('https://report.bkper.app/?book=book-3');
        expect(state.names.bookId).toBe('book-3');
        state.select(undefined);
        expect(state.names.bookId).toBeUndefined();
        expect(namesApi.asked).toEqual(['book-1', 'book-1', 'book-2', 'book-3']);
    });

    it('loads the Book picker after authentication succeeds', async () => {
        const { state, signIn } = createApp('https://report.bkper.app/');

        await signIn();

        expect(state.books.loading).toBe(false);
        expect(state.books.books).toEqual([{ id: 'book-1', name: 'Main Book' }]);
    });

    it('lists the Books changed most recently first', async () => {
        const { state, signIn } = createApp(
            'https://report.bkper.app/',
            createBookService({
                listBooksDirect: async () => [
                    { id: 'old', name: 'Old', lastUpdateMs: 10 },
                    { id: 'never', name: 'Never' },
                    { id: 'new', name: 'New', lastUpdateMs: 30 },
                    { id: 'mid', name: 'Mid', lastUpdateMs: 20 },
                ],
            })
        );

        await signIn();

        expect(state.books.books.map(book => book.id)).toEqual(['new', 'mid', 'old', 'never']);
    });

    it('shows a safe error when initial Bkper data cannot be loaded', async () => {
        const { state, signIn } = createApp(
            'https://report.bkper.app/',
            createBookService({
                listBooksDirect: async () => {
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
        expect(state.books.selectedBookError).toBe('error_book_load');
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

    describe('opening a Book with nothing asked', () => {
        const FIRST = { id: 'f'.repeat(64), prompt: 'Saved first' };
        const SECOND = { id: 'e'.repeat(64), prompt: 'Saved second' };
        const SUGGESTED: Suggestion[] = [
            {
                text: 'Suggested first',
                intent: {
                    root: 'g-1',
                    period: { span: 'year' as const, year: 2011 },
                    monthly: true,
                },
            },
            {
                text: 'Suggested second',
                intent: {
                    root: 'g-2',
                    period: { span: 'year' as const, year: 2011 },
                    monthly: false,
                },
            },
        ];
        const PROBLEM: BookProblem = {
            code: 'empty_book',
            book: 'Main Book',
            canOrganize: true,
        };
        type Shelf = Awaited<ReturnType<SavedReportsApi['savedReports']>>;

        function deferred<T>() {
            let resolve!: (value: T) => void;
            let reject!: (reason: unknown) => void;
            const promise = new Promise<T>((yes, no) => {
                resolve = yes;
                reject = no;
            });
            return { promise, resolve, reject };
        }
        /** The deferred answer for `key`, made when first asked for or answered. */
        function answers<T>() {
            const all = new Map<string, ReturnType<typeof deferred<T>>>();
            return (key: string) => {
                const found = all.get(key) ?? deferred<T>();
                all.set(key, found);
                return found;
            };
        }

        /** An app whose shelves and suggestions answer, per Book, when a test says so. */
        function openingApp(href = 'https://report.bkper.app/?book=book-1') {
            const { page, goTo } = createPage(href);
            const shelf = answers<Shelf>();
            const suggestions = answers<SuggestionsResponse>();
            const asked: { bookId: string; body: ReportRequest }[] = [];
            const auth: { callbacks?: AuthSessionCallbacks } = {};
            const app = new AppState({
                page,
                embedded: false,
                language: 'en',
                createReportApi: () => ({
                    suggestions: bookId => suggestions(bookId).promise,
                    report: async (bookId, body) => {
                        asked.push({ bookId, body });
                        return reportOf(body);
                    },
                }),
                createSavedReportsApi: () => ({
                    ...createShelfApi().api,
                    savedReports: bookId => shelf(bookId).promise,
                }),
                createBookNamesApi: () => createNamesApi().api,
                loadRenderer: async () => undefined,
                loadStrings: async () => undefined,
                createAuthSession: callbacks => {
                    auth.callbacks = callbacks;
                    return createAuth();
                },
                createBookService: () => createBookService(),
                logger: { error: () => undefined },
            });
            app.connect();
            const selected: string[] = [];
            app.reports.addEventListener(SELECT_TEXT, () => selected.push(app.reports.text));
            const signIn = async () => auth.callbacks?.onLoginSuccess?.();
            const prompts = () => asked.flatMap(({ body }) => (body.prompt ? [body.prompt] : []));
            /** Let answered requests run their continuations. */
            const settle = () => new Promise(resolve => setTimeout(resolve));
            const url = () => new URL(page.location.href).searchParams;
            return { app, page, goTo, shelf, suggestions, signIn, selected, prompts, settle, url };
        }

        function reportOf(body: ReportRequest): ReportResponse {
            const intent = body.intent ?? {
                root: 'g-9',
                period: { span: 'year' as const, year: 2012 },
                monthly: false,
            };
            const props = {
                title: body.prompt ?? intent.root,
                subtitle:
                    typeof intent.period === 'string' ? intent.period : `${intent.period.year}`,
                locale: 'en',
                dir: 'ltr' as const,
                fractionDigits: 2,
            };
            return {
                spec: {
                    root: 'report',
                    elements: { report: { type: 'Report', props, children: [] } },
                },
                intent,
                language: 'en',
                query: 'q',
                dataAt: '2026-11-05T00:00:00Z',
                chart: { kind: 'none', fallback: false },
                trace: {
                    facts: {
                        rows: 2,
                        negative: 0,
                        mixed: false,
                        months: 12,
                        previous: true,
                        net: false,
                        permanent: false,
                    },
                    chart: { fitting: ['table'], main: 'none', rule: 'rules' },
                },
                url: 'https://report.bkper.app/',
            };
        }

        const stateOf = (report: ReportResponse | undefined) =>
            report && encodeReportState({ intent: report.intent, language: report.language });

        it('opens the first saved prompt as clicking it, once the shelf settles after the suggestions', async () => {
            const { app, shelf, suggestions, signIn, selected, prompts, settle, url } =
                openingApp();
            await signIn();
            suggestions('book-1').resolve({ suggestions: SUGGESTED });
            await settle();
            expect(app.reports.text).toBe('');
            expect(selected).toEqual([]);

            shelf('book-1').resolve({ reports: [FIRST, SECOND], capabilities: WRITE });
            await settle();

            expect(prompts()).toEqual([FIRST.prompt]);
            expect(app.reports.text).toBe(FIRST.prompt);
            expect(app.reports.originalPrompt).toBe(FIRST.prompt);
            expect(selected).toEqual([FIRST.prompt]);
            expect(url().get('q')).toBe(FIRST.prompt);
            expect(url().get('state')).toBe(stateOf(app.reports.report));

            // Within a minute, clicking it shows it from memory: one Bkper AI call in all.
            app.openSavedReport(FIRST.id);
            await settle();
            expect(prompts()).toEqual([FIRST.prompt]);
            expect(selected).toEqual([FIRST.prompt]);
        });

        it('opens the first suggestion as clicking it when the shelf has none, before or after it settles', async () => {
            for (const shelfFirst of [true, false]) {
                const { app, shelf, suggestions, signIn, selected, prompts, settle, url } =
                    openingApp();
                await signIn();
                const empty = () => shelf('book-1').resolve({ reports: [], capabilities: WRITE });
                if (shelfFirst) empty();
                await settle();
                expect(app.reports.text).toBe('');
                suggestions('book-1').resolve({ suggestions: SUGGESTED });
                if (!shelfFirst) {
                    await settle();
                    expect(app.reports.text).toBe('');
                    empty();
                }
                await settle();

                expect(app.reports.text).toBe(SUGGESTED[0].text);
                expect(app.reports.report?.intent).toEqual(SUGGESTED[0].intent);
                expect(app.reports.originalPrompt).toBeUndefined();
                expect(prompts()).toEqual([]);
                expect(selected).toEqual([SUGGESTED[0].text]);
                expect(url().get('q')).toBe(SUGGESTED[0].text);
                expect(url().get('state')).toBe(stateOf(app.reports.report));
            }
        });

        it('opens the first suggestion when the shelf fails to load', async () => {
            const { app, shelf, suggestions, signIn, selected, settle } = openingApp();
            await signIn();
            suggestions('book-1').resolve({ suggestions: SUGGESTED });
            shelf('book-1').reject(new Error('Offline'));
            await settle();

            expect(app.savedReports.loadError).toBe('unexpected');
            expect(app.reports.text).toBe(SUGGESTED[0].text);
            expect(selected).toEqual([SUGGESTED[0].text]);

            // A shelf that loads later does not open again.
            shelf('book-1').resolve({ reports: [FIRST], capabilities: WRITE });
            await settle();
            expect(selected).toEqual([SUGGESTED[0].text]);
        });

        it('opens nothing without suggestions, or with a Book problem', async () => {
            for (const answer of [
                { suggestions: [] },
                { suggestions: SUGGESTED, problem: PROBLEM },
            ] satisfies SuggestionsResponse[]) {
                const { app, shelf, suggestions, signIn, selected, settle, url } = openingApp();
                await signIn();
                shelf('book-1').resolve({ reports: [], capabilities: WRITE });
                suggestions('book-1').resolve(answer);
                await settle();
                expect(app.reports.text).toBe('');
                expect(app.reports.report).toBeUndefined();
                expect(selected).toEqual([]);
                expect(url().get('q')).toBeNull();
            }
        });

        it('opens nothing when the URL asks for a request or a state', async () => {
            const revenue = encodeReportState({
                intent: {
                    root: 'g-2',
                    period: { span: 'year' as const, year: 2012 },
                    monthly: false,
                },
            });
            for (const query of ['q=net%20result', `state=${revenue}`]) {
                const { app, shelf, suggestions, signIn, selected, prompts, settle } = openingApp(
                    `https://report.bkper.app/?book=book-1&${query}`
                );
                await signIn();
                shelf('book-1').resolve({ reports: [FIRST], capabilities: WRITE });
                suggestions('book-1').resolve({ suggestions: SUGGESTED });
                await settle();
                expect(selected).toEqual([]);
                expect(prompts()).not.toContain(FIRST.prompt);
                expect(app.reports.text).not.toBe(SUGGESTED[0].text);
            }
        });

        it('lets the person, a state or a navigation on the Book act first', async () => {
            const acts: [string, (app: AppState, goTo: (url: string) => void) => void][] = [
                ['typing, then clearing', app => (app.reports.input('net'), app.reports.input(''))],
                ['submitting', app => app.reports.submit()],
                ['choosing a suggestion', app => app.reports.choose(SUGGESTED[1])],
                ['opening a saved prompt', app => app.reports.runSaved(SECOND.prompt)],
                [
                    'a state',
                    app => app.reports.openState({ intent: SUGGESTED[1].intent, language: 'en' }),
                ],
                ['Back or Forward', (_app, goTo) => goTo('https://report.bkper.app/?book=book-1')],
            ];
            for (const [, act] of acts) {
                const { app, goTo, shelf, suggestions, signIn, selected, prompts, settle } =
                    openingApp();
                await signIn();
                act(app, goTo);
                shelf('book-1').resolve({ reports: [FIRST], capabilities: WRITE });
                suggestions('book-1').resolve({ suggestions: SUGGESTED });
                await settle();
                expect(selected).toEqual([]);
                expect(prompts()).not.toContain(FIRST.prompt);
            }
        });

        it('opens the Book selected instead of the one it leaves, never again after clearing or on Back', async () => {
            const { app, goTo, shelf, suggestions, signIn, selected, settle, url } = openingApp(
                'https://report.bkper.app/'
            );
            await signIn();
            app.select('book-1');
            app.select('book-2');
            shelf('book-1').resolve({ reports: [FIRST], capabilities: WRITE });
            suggestions('book-1').resolve({ suggestions: SUGGESTED });
            await settle();
            expect(selected).toEqual([]);

            shelf('book-2').resolve({ reports: [SECOND], capabilities: WRITE });
            suggestions('book-2').resolve({ suggestions: SUGGESTED });
            await settle();
            expect(app.reports.bookId).toBe('book-2');
            expect(selected).toEqual([SECOND.prompt]);
            expect(url().get('q')).toBe(SECOND.prompt);

            app.reports.input('');
            await app.savedReports.load();
            await settle();
            expect(app.reports.text).toBe('');

            goTo('https://report.bkper.app/?book=book-3');
            shelf('book-3').resolve({ reports: [FIRST], capabilities: WRITE });
            suggestions('book-3').resolve({ suggestions: SUGGESTED });
            await settle();
            expect(app.reports.bookId).toBe('book-3');
            expect(app.reports.text).toBe('');
            expect(selected).toEqual([SECOND.prompt]);
        });
    });

    describe('in a Book that keeps the report’s state', () => {
        const BKPER = 'https://bkper.app';
        const EXPENSES = {
            root: 'g-1',
            period: { span: 'year' as const, year: 2011 },
            monthly: true,
            chart: 'area' as const,
        };
        const REVENUE = {
            root: 'g-2',
            period: { span: 'year' as const, year: 2012 },
            monthly: false,
        };
        const state = (intent: ReportResponse['intent'], language = 'pt') =>
            encodeReportState({ intent, language }) ?? '';

        /** A report API that answers each request at once, echoing its intent. */
        function answeringApi() {
            const bodies: ReportRequest[] = [];
            const api: ReportApi = {
                suggestions: async () => ({ suggestions: [] }),
                report: async (_bookId, body) => {
                    bodies.push(body);
                    const intent = body.intent ?? REVENUE;
                    const props = {
                        title: body.intent ? `By intent ${intent.root}` : `Typed ${body.prompt}`,
                        subtitle:
                            typeof intent.period === 'string'
                                ? intent.period
                                : `${intent.period.year}`,
                        locale: 'pt',
                        dir: 'ltr' as const,
                        fractionDigits: 2,
                    };
                    return {
                        spec: {
                            root: 'report',
                            elements: { report: { type: 'Report', props, children: [] } },
                        },
                        intent,
                        language: body.language ?? 'pt',
                        query: 'q',
                        dataAt: '2026-11-05T00:00:00Z',
                        chart: { kind: 'bar', fallback: false },
                        trace: {
                            facts: {
                                rows: 2,
                                negative: 0,
                                mixed: false,
                                months: 12,
                                previous: true,
                                net: false,
                                permanent: false,
                            },
                            chart: { fitting: ['bar', 'pie', 'table'], main: 'bar', rule: 'rules' },
                        },
                        url: 'https://report.bkper.app/',
                    } satisfies ReportResponse;
                },
            };
            return { api, bodies };
        }

        function embeddedApp(href: string, embedded = true) {
            const { page } = createPage(href);
            const parent = { postMessage: vi.fn() };
            const host: HostPage = Object.assign(new EventTarget(), {
                parent,
                location: { origin: 'https://report.bkper.app' },
            });
            const { api, bodies } = answeringApi();
            const shelfApi = createShelfApi();
            const auth: { callbacks?: AuthSessionCallbacks } = {};
            const app = new AppState({
                page,
                host,
                embedded,
                language: 'en',
                createReportApi: () => api,
                createSavedReportsApi: () => shelfApi.api,
                loadRenderer: async () => undefined,
                loadStrings: async () => undefined,
                createAuthSession: callbacks => {
                    auth.callbacks = callbacks;
                    return createAuth();
                },
                createBookService: () => createBookService(),
                logger: { error: () => undefined },
            });
            app.connect();
            const send = (data: unknown) => {
                const event = new MessageEvent('message', { data, origin: BKPER });
                Object.defineProperty(event, 'source', { value: parent });
                host.dispatchEvent(event);
            };
            const ready = (supports = ['navigate', 'app-state']) =>
                send({ type: 'bkper:host-ready', supports });
            const sent = () =>
                parent.postMessage.mock.calls.map(([message, origin]) => ({ message, origin }));
            const signIn = async () => auth.callbacks?.onLoginSuccess?.();
            return { app, page, bodies, send, ready, sent, signIn, shelfApi };
        }

        it('wires only the shown original prompt to Save and never saves a restored title', async () => {
            const { app, signIn, shelfApi, send } = embeddedApp(
                `https://report.bkper.app/?book=b&q=Old%20URL%20text&state=${state(EXPENSES)}`
            );
            await signIn();
            await vi.waitFor(() => expect(app.reports.report).toBeDefined());
            expect(app.savedReports.canSave).toBe(false);
            await app.savedReports.save();
            expect(shelfApi.saved).toEqual([]);
            app.reports.input('Receitas este ano');
            app.reports.submit();
            await vi.waitFor(() => expect(app.savedReports.canSave).toBe(true));
            app.reports.chooseChart('pie');
            app.reports.input('Not yet shown');
            await app.savedReports.save();
            expect(shelfApi.saved).toEqual([{ book: 'b', prompt: 'Receitas este ano' }]);
            send({
                type: 'bkper:app-url-changed',
                url: `https://report.bkper.app/?book=b&state=${state(REVENUE)}`,
            });
            await vi.waitFor(() => expect(app.reports.originalPrompt).toBeUndefined());
            expect(app.savedReports.canSave).toBe(false);
            expect(shelfApi.loaded).toEqual(['b']);
            app.reports.input('');
        });

        it('opens the report of the state in its URL by intent, without AI', async () => {
            const { app, bodies, signIn } = embeddedApp(
                `https://report.bkper.app/?book=b&q=net&state=${state(EXPENSES, 'es')}`
            );
            await signIn();

            await vi.waitFor(() => expect(app.reports.report?.intent).toEqual(EXPENSES));
            expect(bodies).toEqual([{ intent: EXPENSES, language: 'es' }]);
            expect(app.reports.text).toBe('By intent g-1 2011');
        });

        it('runs the request in the URL when its state is missing, unreplaced or invalid', async () => {
            for (const value of ['', '$%7Bapp.state%7D', '1notastate']) {
                const { bodies, signIn } = embeddedApp(
                    `https://report.bkper.app/?book=b&q=despesas%202011&state=${value}`
                );
                await signIn();
                await vi.waitFor(() => expect(bodies).toEqual([{ prompt: 'despesas 2011' }]));
            }
        });

        it('sends the state of the report shown only once the Book keeps it', async () => {
            const { app, page, ready, sent, signIn } = embeddedApp(
                'https://report.bkper.app/?book=b&q=receitas%202012'
            );
            await signIn();
            await vi.waitFor(() => expect(app.reports.report).toBeDefined());
            ready(['navigate']);
            expect(sent()).toEqual([]);

            ready();

            const expected = state(REVENUE);
            expect(sent()).toEqual([
                { message: { type: 'bkper:app-state', state: expected }, origin: BKPER },
            ]);
            expect(new URL(page.location.href).searchParams.get('state')).toBe(expected);
            expect(decodeReportState(expected)?.intent).toEqual(REVENUE);

            // The same report again, or Bkper saying it host-ready again, sends nothing new.
            ready();
            app.reports.submit();
            await vi.waitFor(() => expect(app.reports.pending).toBe(false));
            expect(sent()).toHaveLength(1);
        });

        it('sends the state of the chart chosen, and keeps it in its URL', async () => {
            const { app, page, ready, sent, signIn } = embeddedApp(
                'https://report.bkper.app/?book=b&q=receitas%202012'
            );
            ready();
            await signIn();
            await vi.waitFor(() => expect(app.reports.report).toBeDefined());
            const stateIn = () => new URL(page.location.href).searchParams.get('state');
            expect(stateIn()).toBe(state(REVENUE));

            app.reports.chooseChart('pie');

            const pie = state({ ...REVENUE, chart: 'pie' });
            expect(sent().at(-1)).toEqual({
                message: { type: 'bkper:app-state', state: pie },
                origin: BKPER,
            });
            expect(stateIn()).toBe(pie);

            // Back to the main chart: the report's own state.
            app.reports.chooseChart('bar');
            expect(sent().at(-1)?.message).toEqual({
                type: 'bkper:app-state',
                state: state(REVENUE),
            });
            expect(stateIn()).toBe(state(REVENUE));
            expect(sent()).toHaveLength(3);

            // Another report drops the chart chosen at once: one state, its own.
            app.reports.chooseChart('pie');
            const other = {
                root: 'g-3',
                period: { span: 'year' as const, year: 2013 },
                monthly: false,
            };
            app.reports.openState({ intent: other, language: 'pt' });
            await vi.waitFor(() => expect(app.reports.report?.intent).toEqual(other));
            expect(app.reports.chart).toBeUndefined();
            expect(sent().slice(4)).toEqual([
                { message: { type: 'bkper:app-state', state: state(other) }, origin: BKPER },
            ]);
        });

        it('keeps the state of the report shown in its own URL when standalone', async () => {
            const { app, page, sent, signIn } = embeddedApp(
                'https://report.bkper.app/?book=b&q=receitas%202012',
                false
            );
            await signIn();
            await vi.waitFor(() => expect(app.reports.report).toBeDefined());
            const stateIn = () => new URL(page.location.href).searchParams.get('state');
            expect(stateIn()).toBe(state(REVENUE));

            app.reports.chooseChart('pie');

            expect(stateIn()).toBe(state({ ...REVENUE, chart: 'pie' }));
            expect(new URL(page.location.href).searchParams.get('q')).toBe('receitas 2012');
            expect(sent()).toEqual([]);
        });

        it('does not send back the state it opened with', async () => {
            const { app, ready, sent, signIn } = embeddedApp(
                `https://report.bkper.app/?book=b&state=${state(EXPENSES)}`
            );
            ready();
            await signIn();
            await vi.waitFor(() => expect(app.reports.report?.intent).toEqual(EXPENSES));
            expect(sent()).toEqual([]);
        });

        it('shows the report of a state Bkper changes the app URL to', async () => {
            const { app, bodies, send, ready, sent, signIn } = embeddedApp(
                `https://report.bkper.app/?book=b&state=${state(EXPENSES)}`
            );
            ready();
            await signIn();
            await vi.waitFor(() => expect(app.reports.report?.intent).toEqual(EXPENSES));

            send({
                type: 'bkper:app-url-changed',
                url: `https://report.bkper.app/?book=b&state=${state(REVENUE)}`,
            });

            await vi.waitFor(() => expect(app.reports.report?.intent).toEqual(REVENUE));
            expect(bodies.at(-1)).toEqual({ intent: REVENUE, language: 'pt' });
            expect(app.reports.text).toBe('By intent g-2 2012');
            expect(sent()).toEqual([]);
        });
    });
});
