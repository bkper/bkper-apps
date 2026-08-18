import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { createAppApi, type AppApi } from '../api/app-api';
import {
    createAuthSession,
    type AuthProvider,
    type AuthSession,
    type AuthSessionCallbacks,
} from '../auth/auth-session';
import { createInitialAppState, type AppState } from './app-state';
import { createAppUrlSync, type AppUrlSync } from './app-url-sync';
import { getMenuContext, type CapturedMenuContext } from './menu-context';
import { ReviewSession, type MenuContext } from './review-session';

export interface AppControllerOptions {
    createAuthSession?: (callbacks: AuthSessionCallbacks) => AuthSession;
    createApi?: (auth: AuthProvider) => AppApi;
    getSearch?: () => string;
    createUrlSync?: () => AppUrlSync;
    logger?: Pick<Console, 'debug' | 'error'>;
}

export class AppController implements ReactiveController {
    state: AppState = createInitialAppState();
    readonly review = new ReviewSession();

    private readonly auth: AuthSession;
    private readonly api: AppApi;
    private readonly getSearch: () => string;
    private readonly urlSync: AppUrlSync;
    private readonly logger: Pick<Console, 'debug' | 'error'>;
    private pendingUrl?: URL;
    private reviewEdited = false;
    private contextVersion = 0;
    private activeScan?: AbortController;

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
    }

    hostConnected(): void {
        this.urlSync.start(url => this.handleAppUrlChange(url));
        void this.initialize();
    }

    hostDisconnected(): void {
        this.urlSync.stop();
        this.activeScan?.abort();
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
        const context = this.requireContext();
        if (!context || this.state.analyzing) return;
        const contextVersion = this.contextVersion;
        const abortController = new AbortController();
        this.activeScan = abortController;
        this.logger.debug('[merge-duplicates:sync]', 'scan started', {
            contextVersion,
            query: context.query,
        });
        this.setState({ analyzing: true, error: null, notice: null });
        try {
            const response = await this.api.scan(
                {
                    bookId: context.bookId,
                    query: context.query,
                    cursor: this.review.cursor,
                    fingerprints: this.review.fingerprints,
                },
                abortController.signal
            );
            if (contextVersion !== this.contextVersion) return;
            this.review.appendPage(response);
            this.logger.debug('[merge-duplicates:sync]', 'scan completed', {
                scanned: response.scanned,
                candidates: response.candidateCount,
                suggestions: response.suggestions.length,
            });
            this.setState({
                scanned: this.state.scanned + response.scanned,
                candidateCount: this.state.candidateCount + response.candidateCount,
                pages: this.state.pages + 1,
                skipped: {
                    total: this.state.skipped.total + response.skipped.total,
                    checked: this.state.skipped.checked + response.skipped.checked,
                    trashed: this.state.skipped.trashed + response.skipped.trashed,
                    locked: this.state.skipped.locked + response.skipped.locked,
                },
            });
        } catch (error) {
            if (abortController.signal.aborted) {
                this.logger.debug('[merge-duplicates:sync]', 'scan cancelled', contextVersion);
            } else if (contextVersion === this.contextVersion) {
                this.fail(error);
            }
        } finally {
            if (contextVersion === this.contextVersion) {
                if (this.activeScan === abortController) this.activeScan = undefined;
                this.setState({ authenticating: false, analyzing: false });
            }
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
        const context = this.requireContext();
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
        this.setState({
            applying: false,
            notice: notices.join(' ') || null,
        });
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
        const url = this.pendingUrl;
        await this.acceptContextUrl(url);
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
        this.contextVersion += 1;
        this.activeScan?.abort();
        this.activeScan = undefined;
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

    private resetReview(context: CapturedMenuContext): void {
        this.review.reset();
        this.setState({
            context,
            analyzing: false,
            confirmOpen: false,
            contextUpdateAvailable: false,
            scanned: 0,
            candidateCount: 0,
            pages: 0,
            skipped: { total: 0, checked: 0, trashed: 0, locked: 0 },
            notice: null,
            error: null,
        });
    }

    private requireContext(): MenuContext | undefined {
        const { bookId, query, accountId, groupId } = this.state.context;
        return bookId ? { bookId, query, accountId, groupId } : undefined;
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
