import type {
    LearnRequest,
    LearnResponse,
    MergeRequest,
    MergeResponse,
    ScanResponse,
    Suggestion,
    TransactionFingerprint,
} from '../api/app-api';

export interface MenuContext {
    bookId: string;
    query: string;
    accountId: string | null;
    groupId: string | null;
}

export interface ReviewApi {
    merge(request: MergeRequest): Promise<MergeResponse>;
    learn(request: LearnRequest): Promise<LearnResponse>;
}

export interface PairProgress {
    suggestion: Suggestion;
    status: 'pending' | 'merging' | 'merged' | 'failed';
    message?: string;
}

export interface LearningProgress {
    suggestion: Suggestion;
    status: 'saved' | 'skipped' | 'failed';
    message?: string;
}

export class ReviewSession {
    suggestions: Suggestion[] = [];
    selectedIds = new Set<string>();
    fingerprints: TransactionFingerprint[] = [];
    cursor?: string;
    progress: PairProgress[] = [];
    learningResults: LearningProgress[] = [];
    processed = false;

    get accepted(): Suggestion[] {
        return this.suggestions.filter(suggestion => this.selectedIds.has(suggestion.id));
    }

    get rejected(): Suggestion[] {
        return this.suggestions.filter(suggestion => !this.selectedIds.has(suggestion.id));
    }

    appendPage(response: ScanResponse): void {
        const used = new Set(this.suggestions.flatMap(item => [item.first.id, item.second.id]));
        for (const suggestion of response.suggestions) {
            if (used.has(suggestion.first.id) || used.has(suggestion.second.id)) continue;
            used.add(suggestion.first.id);
            used.add(suggestion.second.id);
            this.suggestions.push(suggestion);
        }
        const fingerprints = new Map(this.fingerprints.map(item => [item.id, item]));
        for (const fingerprint of response.fingerprints)
            fingerprints.set(fingerprint.id, fingerprint);
        this.fingerprints = [...fingerprints.values()];
        this.cursor = response.cursor;
    }

    setSelected(id: string, selected: boolean): void {
        if (!this.suggestions.some(suggestion => suggestion.id === id)) return;
        if (selected) {
            this.selectedIds.add(id);
        } else {
            this.selectedIds.delete(id);
        }
    }

    setAllSelected(selected: boolean): void {
        this.selectedIds = selected
            ? new Set(this.suggestions.map(suggestion => suggestion.id))
            : new Set();
    }

    async apply(api: ReviewApi, context: MenuContext, notify: () => void): Promise<void> {
        const accepted = [...this.accepted];
        const rejected = [...this.rejected];
        this.progress = accepted.map(suggestion => ({ suggestion, status: 'pending' }));
        this.learningResults = [];
        notify();

        for (let index = 0; index < accepted.length; index += 1) {
            const suggestion = accepted[index];
            this.progress[index] = { suggestion, status: 'merging' };
            notify();
            try {
                const result = await api.merge({
                    bookId: context.bookId,
                    firstTransactionId: suggestion.first.id,
                    secondTransactionId: suggestion.second.id,
                });
                this.progress[index] = {
                    suggestion,
                    status: 'merged',
                    message: `Created ${result.mergedTransactionId}`,
                };
            } catch (error) {
                this.progress[index] = {
                    suggestion,
                    status: 'failed',
                    message: toErrorMessage(error),
                };
            }
            notify();
        }

        for (const suggestion of rejected) {
            try {
                const result = await api.learn({
                    bookId: context.bookId,
                    accountId: context.accountId,
                    groupId: context.groupId,
                    pair: { first: suggestion.first, second: suggestion.second },
                });
                this.learningResults.push({
                    suggestion,
                    status: result.skipped ? 'skipped' : 'saved',
                    message: result.notice,
                });
            } catch (error) {
                this.learningResults.push({
                    suggestion,
                    status: 'failed',
                    message: toErrorMessage(error),
                });
            }
            notify();
        }

        this.cursor = undefined;
        this.fingerprints = [];
        this.processed = true;
        notify();
    }

    reset(): void {
        this.suggestions = [];
        this.selectedIds = new Set();
        this.fingerprints = [];
        this.cursor = undefined;
        this.progress = [];
        this.learningResults = [];
        this.processed = false;
    }
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
