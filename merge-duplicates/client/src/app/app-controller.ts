import { Amount, Permission, type Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { createAppApi, type AppApi, type Transaction } from '../api/app-api';
import {
    createAuthSession,
    type AuthProvider,
    type AuthSession,
    type AuthSessionCallbacks,
} from '../auth/auth-session';
import { createBookService, type BookService } from '../services/book-service';
import { createInitialAppState, type AppState } from './app-state';
import { createAppUrlSync, type AppUrlSync } from './app-url-sync';
import { getMenuContext, type CapturedMenuContext } from './menu-context';
import { ReviewSession, type MenuContext, type ReviewPermission } from './review-session';

const PAGE_SIZE = 200;
const MAX_ANALYZE_TRANSACTIONS = 1_000;

export interface AppControllerOptions {
    createAuthSession?: (callbacks: AuthSessionCallbacks) => AuthSession;
    createApi?: (auth: AuthProvider) => AppApi;
    createBookService?: (auth: AuthProvider) => BookService;
    getSearch?: () => string;
    createUrlSync?: () => AppUrlSync;
    logger?: Pick<Console, 'debug' | 'error'>;
}

export class AppController implements ReactiveController {
    state: AppState = createInitialAppState();
    readonly review = new ReviewSession();

    private readonly auth: AuthSession;
    private readonly api: AppApi;
    private readonly bookService: BookService;
    private readonly getSearch: () => string;
    private readonly urlSync: AppUrlSync;
    private readonly logger: Pick<Console, 'debug' | 'error'>;
    private pendingUrl?: URL;
    private reviewEdited = false;
    private contextVersion = 0;
    private activeAnalysis?: AbortController;
    private activeBook?: Book;
    private activeBookId?: string;

    constructor(
        private readonly host: ReactiveControllerHost,
        options: AppControllerOptions = {}
    ) {
        host.addController(this);
        this.getSearch = options.getSearch ?? (() => window.location.search);
        this.urlSync = (options.createUrlSync ?? createAppUrlSync)();
        this.logger = options.logger ?? console;
        const authFactory = options.createAuthSession ?? createAuthSession;
        this.auth = authFactory({
            onLoginSuccess: () => this.begin(),
            onError: error => this.fail(error),
        });
        this.api = (
            options.createApi ??
            (auth => createAppApi({ fetch: request => auth.authenticatedFetch(request) }))
        )(this.auth);
        this.bookService = (options.createBookService ?? createBookService)(this.auth);
    }

    hostConnected(): void {
        this.urlSync.start(url => this.handleAppUrlChange(url));
        void this.initialize();
    }

    hostDisconnected(): void {
        this.urlSync.stop();
        this.activeAnalysis?.abort();
    }

    async initialize(): Promise<void> {
        this.setState({ context: getMenuContext(this.getSearch()) });
        if (!this.state.context.bookId) {
            this.setState({
                authenticating: false,
                error: 'Open Merge Duplicates from a Bkper Book.',
            });
            return;
        }
        await this.auth.init();
    }

    async analyzeNext(): Promise<void> {
        const context = this.requireCapturedContext();
        if (
            !context ||
            this.state.analyzing ||
            this.review.transactions.length >= MAX_ANALYZE_TRANSACTIONS
        )
            return;
        const contextVersion = this.contextVersion;
        const abortController = new AbortController();
        this.activeAnalysis = abortController;
        this.logger.debug('[merge-duplicates:sync]', 'analysis started', {
            contextVersion,
            query: context.query,
        });
        this.setState({ analyzing: true, error: null, notice: null });

        try {
            const book = await this.getActiveBook(context.bookId);
            if (contextVersion !== this.contextVersion) return;
            const permission = toReviewPermission(book.getPermission());
            this.setState({ permission });

            const page = await book.listTransactions(context.query, PAGE_SIZE, this.review.cursor);
            if (contextVersion !== this.contextVersion) return;
            const pageTransactions = page.getItems().map(transaction => transaction.json());
            const cumulativeTransactions = mergeTransactions(
                this.review.transactions,
                pageTransactions
            ).slice(0, MAX_ANALYZE_TRANSACTIONS);
            const response = await this.api.analyze(
                { bookId: context.bookId, transactions: cumulativeTransactions },
                abortController.signal
            );
            if (contextVersion !== this.contextVersion) return;

            const pageCursor = page.getCursor();
            const cursor =
                cumulativeTransactions.length < MAX_ANALYZE_TRANSACTIONS ? pageCursor : undefined;
            this.review.replaceAnalysis(response, cumulativeTransactions, cursor);
            this.logger.debug('[merge-duplicates:sync]', 'analysis completed', {
                scanned: pageTransactions.length,
                suggestions: response.suggestions.length,
            });
            this.setState({
                scanned: this.state.scanned + pageTransactions.length,
                pages: this.state.pages + 1,
                skipped: response.skipped,
            });
        } catch (error) {
            if (abortController.signal.aborted) {
                this.logger.debug('[merge-duplicates:sync]', 'analysis cancelled', contextVersion);
            } else if (contextVersion === this.contextVersion) {
                this.fail(error);
            }
        } finally {
            if (contextVersion === this.contextVersion) {
                if (this.activeAnalysis === abortController) this.activeAnalysis = undefined;
                this.setState({ authenticating: false, analyzing: false });
            }
        }
    }

    formatAmount(value: string | undefined): string {
        if (!value) return '';
        try {
            return this.activeBook?.formatValue(new Amount(value)) ?? value;
        } catch {
            return value;
        }
    }

    setSuggestionSelected(id: string, selected: boolean): void {
        const previouslySelected = this.review.selectedIds.has(id);
        this.review.setSelected(id, selected);
        if (previouslySelected !== this.review.selectedIds.has(id)) this.reviewEdited = true;
        this.host.requestUpdate();
    }

    setAllSuggestionsSelected(selected: boolean): void {
        const previouslySelected = this.review.selectedIds.size;
        this.review.setAllSelected(selected);
        if (previouslySelected !== this.review.selectedIds.size) this.reviewEdited = true;
        this.host.requestUpdate();
    }

    showConfirmation(): void {
        if (this.review.suggestions.length === 0) return;
        this.setState({ confirmOpen: true });
    }

    hideConfirmation(): void {
        this.setState({ confirmOpen: false });
    }

    async confirmApply(): Promise<void> {
        const context = this.requireReviewContext();
        if (!context || this.state.applying) return;
        this.setState({ confirmOpen: false, applying: true, error: null, notice: null });
        await this.review.apply(this.api, context, () => this.host.requestUpdate());
        const failedMerges = this.review.progress.filter(item => item.status === 'failed').length;
        const failedLearning = this.review.learningResults
            .filter(item => item.status === 'failed')
            .reduce((count, item) => count + item.suggestions.length, 0);
        const skippedLearning = this.review.learningResults.some(item => item.status === 'skipped');
        const notices = [
            failedMerges ? `${failedMerges} merge${failedMerges === 1 ? '' : 's'} failed.` : '',
            failedLearning
                ? `${failedLearning} learning example${failedLearning === 1 ? '' : 's'} failed.`
                : '',
            skippedLearning
                ? 'Learning was skipped because Post collaborators cannot edit properties.'
                : '',
        ].filter(Boolean);
        this.setState({ applying: false, notice: notices.join(' ') || null });
    }

    async scanAgain(): Promise<void> {
        if (this.pendingUrl) {
            await this.updateResults();
            return;
        }
        this.reviewEdited = false;
        this.resetReview(this.state.context);
        await this.analyzeNext();
    }

    async updateResults(): Promise<void> {
        if (!this.pendingUrl || this.state.applying) return;
        await this.acceptContextUrl(this.pendingUrl);
    }

    private async begin(): Promise<void> {
        this.setState({ authenticating: false });
        await this.analyzeNext();
    }

    private async handleAppUrlChange(url: URL): Promise<void> {
        const nextContext = getMenuContext(url.search);
        if (sameContext(nextContext, this.state.context)) {
            this.logger.debug('[merge-duplicates:sync]', 'context unchanged');
            this.pendingUrl = undefined;
            this.setState({ contextUpdateAvailable: false });
            return;
        }

        if (this.pendingUrl || this.reviewEdited || this.state.confirmOpen || this.state.applying) {
            this.logger.debug('[merge-duplicates:sync]', 'context deferred', {
                edited: this.reviewEdited,
                confirming: this.state.confirmOpen,
                applying: this.state.applying,
            });
            this.pendingUrl = url;
            this.setState({ contextUpdateAvailable: true });
            return;
        }

        this.logger.debug('[merge-duplicates:sync]', 'context accepted', nextContext);
        await this.acceptContextUrl(url);
    }

    private async acceptContextUrl(url: URL): Promise<void> {
        const context = getMenuContext(url.search);
        const shouldScan = !this.state.authenticating;
        const bookChanged = context.bookId !== this.state.context.bookId;
        this.contextVersion += 1;
        this.activeAnalysis?.abort();
        this.activeAnalysis = undefined;
        if (bookChanged) {
            this.activeBook = undefined;
            this.activeBookId = undefined;
        }
        this.urlSync.replace(url);
        this.pendingUrl = undefined;
        this.reviewEdited = false;
        this.resetReview(context);

        if (!context.bookId) {
            this.setState({ error: 'Open Merge Duplicates from a Bkper Book.' });
            return;
        }
        if (shouldScan) await this.analyzeNext();
    }

    private async getActiveBook(bookId: string): Promise<Book> {
        if (!this.activeBook || this.activeBookId !== bookId) {
            this.activeBook = await this.bookService.getBook(bookId);
            this.activeBookId = bookId;
        }
        return this.activeBook;
    }

    private resetReview(context: CapturedMenuContext): void {
        this.review.reset();
        this.setState({
            context,
            analyzing: false,
            confirmOpen: false,
            contextUpdateAvailable: false,
            scanned: 0,
            permission: null,
            pages: 0,
            skipped: { total: 0, checked: 0, trashed: 0, locked: 0, invalid: 0 },
            notice: null,
            error: null,
        });
    }

    private requireCapturedContext(): (CapturedMenuContext & { bookId: string }) | undefined {
        return this.state.context.bookId
            ? { ...this.state.context, bookId: this.state.context.bookId }
            : undefined;
    }

    private requireReviewContext(): MenuContext | undefined {
        const context = this.requireCapturedContext();
        const permission = this.state.permission;
        return context && permission ? { ...context, permission } : undefined;
    }

    private fail(error: unknown): void {
        this.logger.error('Merge Duplicates error:', error);
        this.setState({ error: toErrorMessage(error) });
    }

    private setState(patch: Partial<AppState>): void {
        this.state = { ...this.state, ...patch };
        this.host.requestUpdate();
    }
}

function mergeTransactions(
    previous: readonly Transaction[],
    current: readonly Transaction[]
): Transaction[] {
    const merged = new Map<string, Transaction>();
    for (const transaction of [...previous, ...current]) {
        const id = transaction.id;
        if (typeof id === 'string' && id.length > 0) merged.set(id, transaction);
        else merged.set(`missing-${merged.size}`, transaction);
    }
    return [...merged.values()];
}

function toReviewPermission(permission: Permission): ReviewPermission {
    if (permission === Permission.OWNER) return 'OWNER';
    if (permission === Permission.EDITOR) return 'EDITOR';
    if (permission === Permission.POSTER) return 'POSTER';
    throw new Error(
        `Merge Duplicates requires Owner, Editor, or Post permission. Current: ${permission}.`
    );
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sameContext(first: CapturedMenuContext, second: CapturedMenuContext): boolean {
    return (
        first.bookId === second.bookId &&
        first.query === second.query &&
        first.accountId === second.accountId &&
        first.groupId === second.groupId
    );
}
