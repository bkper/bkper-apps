import type {
    AnalyzeResponse,
    LearnRequest,
    LearnResponse,
    MergeRequest,
    MergeResponse,
    Suggestion,
    Transaction,
} from '../api/app-api';

export type ReviewPermission = 'OWNER' | 'EDITOR' | 'POSTER';

export interface MenuContext {
    bookId: string;
    query: string;
    accountId: string | null;
    groupId: string | null;
    permission: ReviewPermission;
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
    suggestions: Suggestion[];
    status: 'saved' | 'skipped' | 'failed';
    savedCount: number;
    resourceType: 'account' | 'group' | 'book' | null;
    resourceName?: string | null;
    propertyKey?: string;
    message?: string;
}

type TransactionWithId = Transaction & { id: string };

export function suggestionTransactions(
    suggestion: Suggestion
): [TransactionWithId, TransactionWithId] {
    const [first, second] = suggestion.transactions;
    if (
        suggestion.transactions.length !== 2 ||
        !first ||
        !second ||
        typeof first.id !== 'string' ||
        first.id.length === 0 ||
        typeof second.id !== 'string' ||
        second.id.length === 0
    ) {
        throw new Error('A suggestion requires exactly two transactions with IDs.');
    }
    return [first as TransactionWithId, second as TransactionWithId];
}

export function suggestionKey(suggestion: Suggestion): string {
    const [first, second] = suggestionTransactions(suggestion);
    return [first.id, second.id].sort((left, right) => left.localeCompare(right)).join('|');
}

export class ReviewSession {
    suggestions: Suggestion[] = [];
    selectedIds = new Set<string>();
    transactions: Transaction[] = [];
    cursor?: string;
    progress: PairProgress[] = [];
    learningResults: LearningProgress[] = [];
    processed = false;

    get accepted(): Suggestion[] {
        return this.suggestions.filter(suggestion =>
            this.selectedIds.has(suggestionKey(suggestion))
        );
    }

    get rejected(): Suggestion[] {
        return this.suggestions.filter(
            suggestion => !this.selectedIds.has(suggestionKey(suggestion))
        );
    }

    replaceAnalysis(response: AnalyzeResponse, transactions: Transaction[], cursor?: string): void {
        const previousIds = new Set(this.suggestions.map(suggestionKey));
        const previousSelections = this.selectedIds;
        this.suggestions = [...response.suggestions];
        this.selectedIds = new Set(
            this.suggestions
                .filter(suggestion => {
                    const key = suggestionKey(suggestion);
                    return !previousIds.has(key) || previousSelections.has(key);
                })
                .map(suggestionKey)
        );
        this.transactions = transactions;
        this.cursor = cursor;
    }

    setSelected(id: string, selected: boolean): void {
        if (!this.suggestions.some(suggestion => suggestionKey(suggestion) === id)) return;
        if (selected) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
    }

    setAllSelected(selected: boolean): void {
        this.selectedIds = selected
            ? new Set(this.suggestions.map(suggestionKey))
            : new Set<string>();
    }

    async apply(api: ReviewApi, context: MenuContext, notify: () => void): Promise<void> {
        const accepted = [...this.accepted];
        const rejected = [...this.rejected];
        this.progress = accepted.map(suggestion => ({ suggestion, status: 'pending' }));
        this.learningResults = [];
        notify();

        for (let index = 0; index < accepted.length; index += 1) {
            const suggestion = accepted[index];
            const [primary, secondary] = suggestionTransactions(suggestion);
            this.progress[index] = { suggestion, status: 'merging' };
            notify();
            try {
                const result = await api.merge({
                    bookId: context.bookId,
                    primary: { id: primary.id },
                    secondary: { id: secondary.id },
                });
                this.progress[index] = {
                    suggestion,
                    status: 'merged',
                    message: `Created ${result.id ?? 'canonical transaction'}`,
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

        const retainedRejected = rejected.slice(-50);
        if (retainedRejected.length > 0) {
            if (context.permission === 'POSTER') {
                this.learningResults.push({
                    suggestions: retainedRejected,
                    status: 'skipped',
                    savedCount: 0,
                    resourceType: null,
                    message:
                        'Post collaborators can merge, but learning examples require Owner or Editor permission.',
                });
                notify();
            } else {
                try {
                    const result = await api.learn({
                        bookId: context.bookId,
                        ...(context.accountId ? { accountId: context.accountId } : {}),
                        ...(context.groupId ? { groupId: context.groupId } : {}),
                        examples: retainedRejected.map(suggestion => [
                            ...suggestionTransactions(suggestion),
                        ]),
                    });
                    const resource = learningResource(result);
                    this.learningResults.push({
                        suggestions: retainedRejected,
                        status: 'saved',
                        savedCount: retainedRejected.length,
                        resourceType: resource.type,
                        resourceName: resource.name,
                        propertyKey: 'merge_duplicate_examples',
                    });
                } catch (error) {
                    this.learningResults.push({
                        suggestions: retainedRejected,
                        status: 'failed',
                        savedCount: 0,
                        resourceType: null,
                        message: toErrorMessage(error),
                    });
                }
                notify();
            }
        }

        this.cursor = undefined;
        this.transactions = [];
        this.processed = true;
        notify();
    }

    reset(): void {
        this.suggestions = [];
        this.selectedIds = new Set();
        this.transactions = [];
        this.cursor = undefined;
        this.progress = [];
        this.learningResults = [];
        this.processed = false;
    }
}

function learningResource(result: LearnResponse): {
    type: 'book' | 'group' | 'account';
    name: string | null;
} {
    if ('account' in result) return { type: 'account', name: result.account.name ?? null };
    if ('group' in result) return { type: 'group', name: result.group.name ?? null };
    return { type: 'book', name: result.book.name ?? null };
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
