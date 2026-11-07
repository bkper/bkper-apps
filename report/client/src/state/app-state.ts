import {
    createAuthSession,
    type AuthSession,
    type AuthSessionCallbacks,
} from '../auth/auth-session';
import { supportedLanguage } from 'report-shared/languages';
import { decodeReportState, encodeReportState, type ReportState } from 'report-shared/report-state';
import { createAppApi, type AppApi, type ReportResponse } from '../api/app-api';
import { loadReportRenderer } from '../report-loader';
import { createBookService, type BookService } from '../services/book-service';
import { AppUrlChange, BookHost, type HostPage } from './book-host';
import { Books } from './books';
import { Reports, type ChartKind, type ReportApi } from './reports';
import { Navigation, Route, type RoutePage } from './route';
import { Strings } from './strings';
import { SavedReports, type SavedReportsApi } from './saved-reports';

export interface AppStateOptions {
    page?: RoutePage;
    /** The page as the Bkper Book around it talks to it; by default the browser's `window`. */
    host?: HostPage;
    embedded?: boolean;
    /** The language of the interface; by default the browser's, if Bkper has it, else English. */
    language?: string;
    createAuthSession?: (callbacks: AuthSessionCallbacks) => AuthSession;
    createBookService?: (auth: AuthSession) => BookService;
    createReportApi?: (auth: AuthSession) => ReportApi;
    createSavedReportsApi?: (auth: AuthSession) => SavedReportsApi;
    /** Loads the report renderer; by default its code-split bundle. */
    loadRenderer?: () => Promise<void>;
    /** Loads the strings of a language; by default its code-split chunk. */
    loadStrings?: (lang: string) => Promise<void>;
    logger?: Pick<Console, 'error'>;
    /** The clock of the report caches; by default `Date.now`. */
    now?: () => number;
}

/** Creates the app's stores and wires them together. Components get it as their `state`. */
export class AppState {
    readonly route: Route;
    /** The Bkper Book page around the app, when embedded. */
    readonly host: BookHost;
    readonly books: Books;
    readonly reports: Reports;
    readonly savedReports: SavedReports;
    /** The language of the interface's texts. */
    readonly strings: Strings;
    private readonly auth: AuthSession;
    private readonly loadRenderer: () => Promise<void>;
    private readonly logger: Pick<Console, 'error'>;
    private started = false;
    /** In a Book's panel, where the Book keeps the report's state; else the app's own page. */
    private readonly embedded: boolean;
    /** The report, and chart, whose state the URL and the Book have, or were last checked to have. */
    private synced?: { report: ReportResponse; chart?: ChartKind };

    constructor(options: AppStateOptions = {}) {
        const page = options.page ?? window;
        const logger = options.logger ?? console;
        this.logger = logger;
        this.loadRenderer = options.loadRenderer ?? loadReportRenderer;
        this.embedded = options.embedded ?? window.parent !== window;
        this.route = new Route(page, this.embedded);
        this.host = new BookHost(options.host ?? window);
        this.auth = (options.createAuthSession ?? createAuthSession)({
            onLoginSuccess: () => {
                // The report of the URL starts with the Book, not after it.
                this.savedReports.open(this.route.bookId);
                this.reports.open(this.route.bookId, this.route.prompt, this.routeState());
                return this.books.load();
            },
            onError: error => this.books.fail('Auth error:', error),
        });
        const bookService = (options.createBookService ?? createService)(this.auth);
        this.books = new Books(bookService, this.route, logger);
        const api = createReportApi(this.auth);
        const language = options.language ?? browserLanguage();
        this.strings = new Strings(language, options.loadStrings);
        this.reports = new Reports(options.createReportApi?.(this.auth) ?? api, this.route, {
            language,
            logger,
            now: options.now,
        });
        this.savedReports = new SavedReports(options.createSavedReportsApi?.(this.auth) ?? api);
        // Back or Forward, or Bkper changing the app's URL, shows what the URL selects.
        this.route.addEventListener('navigate', event => {
            if (!(event instanceof Navigation)) return;
            const state = this.routeState();
            if (state && event.bookId === this.reports.bookId) {
                this.reports.openState(state);
                return;
            }
            void this.books.select(event.bookId);
            this.savedReports.open(event.bookId);
            this.reports.open(event.bookId, event.prompt, state);
        });
        this.host.addEventListener('app-url-changed', event => {
            if (event instanceof AppUrlChange) this.route.follow(event.url);
        });
        this.host.addEventListener('ready', () => {
            this.synced = undefined;
            this.syncState();
        });
        this.reports.addEventListener('change', () => {
            this.savedReports.setSource(this.reports.bookId, this.reports.originalPrompt);
            this.syncState();
        });
    }

    /** The report the URL's state names, if it is a valid one. */
    private routeState(): ReportState | undefined {
        return this.route.state === undefined ? undefined : decodeReportState(this.route.state);
    }

    /**
     * Keep the state of the report on screen, as the chart chosen shows it, in the URL and in
     * the Book's, so a link, Back or a reload opens it again. In a Book, only while it keeps the
     * state (`bkper:app-state`); standalone, in the app's own URL. A report whose state is too
     * long drops it.
     */
    private syncState(): void {
        const { report, chart } = this.reports;
        if (!report || (report === this.synced?.report && chart === this.synced.chart)) return;
        if (this.embedded && !this.host.acceptsState) return;
        this.synced = { report, chart };
        const intent = chart ? { ...report.intent, chart } : report.intent;
        const state = encodeReportState({ intent, language: report.language });
        if (state === this.route.state) return;
        this.route.setState(state);
        this.host.sendState(state ?? '');
    }

    /** Open a Book, or the Book list without one. */
    readonly select = (bookId: string | undefined): void => {
        void this.books.select(bookId);
        this.savedReports.open(bookId);
        this.reports.open(bookId);
    };

    /**
     * Open the active shelf's original text: its report of the last minute, else the text
     * resolved again (see `Reports.runSaved`).
     */
    readonly openSavedReport = (id: string): void => {
        if (!this.savedReports.canList || this.savedReports.bookId !== this.reports.bookId) return;
        const item = this.savedReports.items.find(report => report.id === id);
        if (item) this.reports.runSaved(item.prompt);
    };

    /**
     * Follow Back and Forward, and the first time sign in, load the interface's strings and
     * preload the report renderer, so the first report shows as soon as it answers.
     */
    connect(): void {
        this.route.connect();
        this.host.connect();
        if (this.started) return;
        this.started = true;
        this.auth.init().catch(error => this.books.fail('Auth error:', error));
        // Without its strings, the interface stays in English.
        this.strings
            .load()
            .catch(error => this.logger.error('Error loading the interface strings:', error));
        this.loadRenderer().catch(error => {
            this.logger.error('Error loading the report renderer:', error);
            this.reports.fail('error_unexpected');
        });
    }
    disconnect(): void {
        this.route.disconnect();
        this.host.disconnect();
    }
}

function createService(auth: AuthSession): BookService {
    return createBookService({ auth });
}

function createReportApi(auth: AuthSession): AppApi {
    return createAppApi({ fetch: request => auth.authenticatedFetch(request) });
}

function browserLanguage(): string {
    return supportedLanguage(navigator.language) ?? 'en';
}
