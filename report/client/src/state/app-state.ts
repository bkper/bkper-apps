import {
    createAuthSession,
    type AuthSession,
    type AuthSessionCallbacks,
} from '../auth/auth-session';
import { supportedLanguage } from 'report-shared/languages';
import { createAppApi } from '../api/app-api';
import { loadReportRenderer } from '../report-loader';
import { createBookService, type BookService } from '../services/book-service';
import { Books } from './books';
import { Reports, type ReportApi } from './reports';
import { Navigation, Route, type RoutePage } from './route';
import { Strings } from './strings';

export interface AppStateOptions {
    page?: RoutePage;
    embedded?: boolean;
    /** The language of the interface; by default the browser's, if Bkper has it, else English. */
    language?: string;
    createAuthSession?: (callbacks: AuthSessionCallbacks) => AuthSession;
    createBookService?: (auth: AuthSession) => BookService;
    createReportApi?: (auth: AuthSession) => ReportApi;
    /** Loads the report renderer; by default its code-split bundle. */
    loadRenderer?: () => Promise<void>;
    /** Loads the strings of a language; by default its code-split chunk. */
    loadStrings?: (lang: string) => Promise<void>;
    logger?: Pick<Console, 'error'>;
}

/** Creates the app's stores and wires them together. Components get it as their `state`. */
export class AppState {
    readonly route: Route;
    readonly books: Books;
    readonly reports: Reports;
    /** The language of the interface's texts. */
    readonly strings: Strings;
    private readonly auth: AuthSession;
    private readonly loadRenderer: () => Promise<void>;
    private readonly logger: Pick<Console, 'error'>;
    private started = false;

    constructor(options: AppStateOptions = {}) {
        const page = options.page ?? window;
        const logger = options.logger ?? console;
        this.logger = logger;
        this.loadRenderer = options.loadRenderer ?? loadReportRenderer;
        this.route = new Route(page, options.embedded ?? window.parent !== window);
        this.auth = (options.createAuthSession ?? createAuthSession)({
            onLoginSuccess: () => {
                // The report of the URL starts with the Book, not after it.
                this.reports.open(this.route.bookId, this.route.prompt);
                return this.books.load();
            },
            onError: error => this.books.fail('Auth error:', error),
        });
        const bookService = (options.createBookService ?? createService)(this.auth);
        this.books = new Books(bookService, this.route, logger);
        const api = (options.createReportApi ?? createReportApi)(this.auth);
        const language = options.language ?? browserLanguage();
        this.strings = new Strings(language, options.loadStrings);
        this.reports = new Reports(api, this.route, { language, logger });
        // Back or Forward shows what the URL selects.
        this.route.addEventListener('navigate', event => {
            if (!(event instanceof Navigation)) return;
            void this.books.select(event.bookId);
            this.reports.open(event.bookId, event.prompt);
        });
    }

    /** Open a Book, or the Book list without one. */
    readonly select = (bookId: string | undefined): void => {
        void this.books.select(bookId);
        this.reports.open(bookId);
    };

    /**
     * Follow Back and Forward, and the first time sign in, load the interface's strings and
     * preload the report renderer, so the first report shows as soon as it answers.
     */
    connect(): void {
        this.route.connect();
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
    }
}

function createService(auth: AuthSession): BookService {
    return createBookService({ auth });
}

function createReportApi(auth: AuthSession): ReportApi {
    return createAppApi({ fetch: request => auth.authenticatedFetch(request) });
}

function browserLanguage(): string {
    return supportedLanguage(navigator.language) ?? 'en';
}
