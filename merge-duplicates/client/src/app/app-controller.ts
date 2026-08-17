import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { createAppApi, type AppApi } from '../api/app-api';
import {
    createAuthSession,
    type AuthProvider,
    type AuthSession,
    type AuthSessionCallbacks,
} from '../auth/auth-session';
import { createInitialAppState, type AppState } from './app-state';
import { getMenuContext } from './menu-context';
import { ReviewSession, type MenuContext } from './review-session';

export interface AppControllerOptions {
    createAuthSession?: (callbacks: AuthSessionCallbacks) => AuthSession;
    createApi?: (auth: AuthProvider) => AppApi;
    getSearch?: () => string;
    logger?: Pick<Console, 'error'>;
}

export class AppController implements ReactiveController {
    state: AppState = createInitialAppState();
    readonly review = new ReviewSession();

    private readonly auth: AuthSession;
    private readonly api: AppApi;
    private readonly getSearch: () => string;
    private readonly logger: Pick<Console, 'error'>;

    constructor(
        private readonly host: ReactiveControllerHost,
        options: AppControllerOptions = {}
    ) {
        host.addController(this);
        this.getSearch = options.getSearch ?? (() => window.location.search);
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
        void this.initialize();
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
        this.setState({ analyzing: true, error: null, notice: null });
        try {
            const response = await this.api.scan({
                bookId: context.bookId,
                query: context.query,
                cursor: this.review.cursor,
                fingerprints: this.review.fingerprints,
            });
            this.review.appendPage(response);
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
            this.fail(error);
        } finally {
            this.setState({ authenticating: false, analyzing: false });
        }
    }

    setSuggestionSelected(id: string, selected: boolean): void {
        this.review.setSelected(id, selected);
        this.host.requestUpdate();
    }

    setAllSuggestionsSelected(selected: boolean): void {
        this.review.setAllSelected(selected);
        this.host.requestUpdate();
    }

    showConfirmation(): void {
        if (this.review.accepted.length === 0) return;
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
        const failedLearning = this.review.learningResults.filter(
            item => item.status === 'failed'
        ).length;
        const skippedLearning = this.review.learningResults.filter(
            item => item.status === 'skipped'
        ).length;
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
            notice: notices.join(' ') || 'Review processing finished.',
        });
    }

    async scanAgain(): Promise<void> {
        this.review.reset();
        this.setState({
            scanned: 0,
            candidateCount: 0,
            pages: 0,
            skipped: { total: 0, checked: 0, trashed: 0, locked: 0 },
            notice: null,
            error: null,
        });
        await this.analyzeNext();
    }

    private async begin(): Promise<void> {
        this.setState({ authenticating: false });
        await this.analyzeNext();
    }

    private requireContext(): MenuContext | undefined {
        const { bookId, query, accountId, groupId } = this.state.context;
        return bookId ? { bookId, query, accountId, groupId } : undefined;
    }

    private fail(error: unknown): void {
        this.logger.error('Merge Duplicates error:', error);
        this.setState({ error: error instanceof Error ? error.message : String(error) });
    }

    private setState(patch: Partial<AppState>): void {
        this.state = { ...this.state, ...patch };
        this.host.requestUpdate();
    }
}
