import {
    AppApiError,
    type AppApi,
    type SavedPrompt,
    type SavedPromptCapabilities,
} from '../api/app-api';
import { reactive, Store } from './store';

export type SavedReportsApi = Pick<
    AppApi,
    'savedReports' | 'saveReport' | 'removeReport' | 'moveReport'
>;

/** Where a prompt can move on the shelf, in its order (first is leftmost in LTR). */
export type ShelfPlace = 'first' | 'earlier' | 'later';

/** Stable reasons for the future UI to localize; never expose upstream messages or prompts. */
export type SavedReportsError =
    | 'unauthorized'
    | 'forbidden'
    | 'book_not_found'
    | 'invalid_request'
    | 'storage_error'
    | 'upstream_error'
    | 'report_not_found'
    | 'shelf_changed'
    | 'unexpected';

/**
 * The active Book's shared shelf of original prompts, not computed reports, in the server's
 * order: the leftmost prompt is first. Switching Books drops all state and reloads
 * capabilities. These are UI hints only: the server authorizes every request afresh. Nothing
 * is persisted in the browser.
 */
export class SavedReports extends Store {
    @reactive bookId?: string;
    @reactive items: readonly SavedPrompt[] = [];
    @reactive capabilities?: SavedPromptCapabilities;
    @reactive loading = false;
    /** The prompt/id whose mutation is pending; at most one mutation runs at a time. */
    @reactive saving?: string;
    @reactive removing?: string;
    @reactive moving?: string;
    @reactive loadError?: SavedReportsError;
    @reactive saveError?: SavedReportsError;
    @reactive removeError?: SavedReportsError;
    @reactive moveError?: SavedReportsError;
    /** Only the source of the report actually shown, supplied by AppState, never input text. */
    @reactive private source?: string;

    private session = 0;
    private listRequest?: { controller: AbortController; promise: Promise<void> };
    private mutation?: { controller: AbortController; promise: Promise<void> };

    constructor(private readonly api: SavedReportsApi) {
        super();
    }

    get canList(): boolean {
        return this.capabilities?.list === true;
    }
    get canSave(): boolean {
        return this.capabilities?.save === true && this.source !== undefined && this.idle;
    }
    get canRemove(): boolean {
        return this.capabilities?.remove === true && this.idle;
    }
    get canMove(): boolean {
        return this.capabilities?.move === true && this.idle;
    }
    private get idle(): boolean {
        return (
            this.saving === undefined && this.removing === undefined && this.moving === undefined
        );
    }

    /** The `before` of a move of `id` to `place` (`null`: the end); undefined when it cannot. */
    beforeFor(id: string, place: ShelfPlace): string | null | undefined {
        return beforeFor(this.items, id, place);
    }

    isSaved(prompt: string): boolean {
        return this.items.some(item => item.prompt === prompt.trim());
    }

    /** Load afresh on a Book change; same-Book report/chart changes do not reload the shelf. */
    open(bookId: string | undefined): void {
        if (bookId === this.bookId) return;
        this.session++;
        this.cancelLoad();
        this.mutation?.controller.abort();
        this.mutation = undefined;
        this.bookId = bookId;
        this.items = [];
        this.capabilities = undefined;
        this.source = undefined;
        this.saving = undefined;
        this.removing = undefined;
        this.moving = undefined;
        this.loadError = undefined;
        this.saveError = undefined;
        this.removeError = undefined;
        this.moveError = undefined;
        if (bookId) void this.load();
    }

    /** AppState keeps the shown report's provenance here; a restored intent has no source. */
    setSource(bookId: string | undefined, prompt: string | undefined): void {
        this.source = bookId === this.bookId ? prompt?.trim() || undefined : undefined;
    }

    /** Explicit reload/retry. Coalesce loads, and do not race a pending mutation against KV. */
    load(): Promise<void> {
        if (!this.bookId || this.mutation) return Promise.resolve();
        if (this.listRequest) return this.listRequest.promise;
        const bookId = this.bookId;
        const controller = new AbortController();
        const session = this.session;
        this.loading = true;
        this.loadError = undefined;
        const promise = this.api
            .savedReports(bookId, { signal: controller.signal })
            .then(
                result => {
                    if (session !== this.session || controller.signal.aborted) return;
                    this.items = unique(result.reports);
                    this.capabilities = result.capabilities;
                },
                (error: unknown) => {
                    if (session !== this.session || controller.signal.aborted || isAbort(error))
                        return;
                    this.loadError = reason(error);
                    this.capabilities = undefined;
                    if (inaccessible(this.loadError)) this.items = [];
                }
            )
            .finally(() => {
                if (session !== this.session || controller.signal.aborted) return;
                this.listRequest = undefined;
                this.loading = false;
            });
        this.listRequest = { controller, promise };
        return promise;
    }

    /** Save the shown original request only. Already saved text and repeated clicks are safe. */
    save(): Promise<void> {
        if (this.mutation && this.saving === this.source) return this.mutation.promise;
        if (!this.canSave || !this.bookId || !this.source || this.isSaved(this.source)) {
            return Promise.resolve();
        }
        const bookId = this.bookId;
        const prompt = this.source;
        this.saveError = undefined;
        return this.mutate('save', prompt, async signal => {
            const item = await this.api.saveReport(bookId, { prompt }, { signal });
            return () => {
                // A new prompt goes last on the server; one saved again keeps its place.
                this.items = this.items.some(row => row.id === item.id)
                    ? this.items.map(row => (row.id === item.id ? item : row))
                    : [...this.items, item];
            };
        });
    }

    /** Remove a shelf item only after success, so failures need no optimistic rollback. */
    remove(id: string): Promise<void> {
        if (this.mutation && this.removing === id) return this.mutation.promise;
        if (!this.canRemove || !this.bookId) return Promise.resolve();
        const bookId = this.bookId;
        this.removeError = undefined;
        return this.mutate('remove', id, async signal => {
            await this.api.removeReport(bookId, id, { signal });
            return () => {
                this.items = this.items.filter(item => item.id !== id);
            };
        });
    }

    /**
     * Move a prompt just before `before` (`null`: the end). The shelf shows the new order at
     * once; the server's answer replaces it, and a failure restores the order it had. When the
     * shelf changed on the server, it is listed again.
     */
    move(id: string, before: string | null): Promise<void> {
        if (this.mutation && this.moving === id) return this.mutation.promise;
        if (!this.canMove || !this.bookId) return Promise.resolve();
        const previous = this.items;
        const items = moved(previous, id, before);
        if (!items) return Promise.resolve();
        const bookId = this.bookId;
        this.moveError = undefined;
        return this.mutate(
            'move',
            id,
            async signal => {
                // Reordered only once `moving` is set, so no change shows it while moves are on.
                this.items = items;
                const result = await this.api.moveReport(bookId, id, { before }, { signal });
                return () => {
                    this.items = unique(result.reports);
                    this.capabilities = result.capabilities;
                };
            },
            () => {
                this.items = previous;
            }
        );
    }

    private mutate(
        operation: 'save' | 'remove' | 'move',
        value: string,
        request: (signal: AbortSignal) => Promise<() => void>,
        rollback?: () => void
    ): Promise<void> {
        // A list already in flight must not undo a confirmed local change, nor replace its
        // capabilities. Later explicit reloads still follow the server's eventual KV view.
        this.cancelLoad();
        const controller = new AbortController();
        const session = this.session;
        const current = () => session === this.session && !controller.signal.aborted;
        let reload = false;
        if (operation === 'save') this.saving = value;
        else if (operation === 'remove') this.removing = value;
        else this.moving = value;
        const promise = request(controller.signal)
            .then(
                apply => {
                    if (current()) apply();
                },
                (error: unknown) => {
                    if (!current()) return;
                    rollback?.();
                    if (isAbort(error)) return;
                    const failure = reason(error);
                    if (operation === 'save') this.saveError = failure;
                    else if (operation === 'remove') this.removeError = failure;
                    else this.moveError = failure;
                    if (failure === 'forbidden' && this.capabilities) {
                        this.capabilities = {
                            ...this.capabilities,
                            save: false,
                            remove: false,
                            move: false,
                        };
                    } else if (inaccessible(failure)) {
                        this.capabilities = undefined;
                        this.items = [];
                    }
                    reload = failure === 'shelf_changed' || failure === 'report_not_found';
                }
            )
            .finally(() => {
                if (!current()) return;
                this.mutation = undefined;
                this.saving = undefined;
                this.removing = undefined;
                this.moving = undefined;
            })
            // The shelf this one showed is stale; list it once the mutation has settled.
            .then(() => (reload && current() ? this.load() : undefined));
        this.mutation = { controller, promise };
        return promise;
    }

    private cancelLoad(): void {
        this.listRequest?.controller.abort();
        this.listRequest = undefined;
        this.loading = false;
    }
}

/** The server's order, each id once, where it first appears. */
function unique(items: readonly SavedPrompt[]): SavedPrompt[] {
    const seen = new Set<string>();
    return items.filter(item => !seen.has(item.id) && seen.add(item.id));
}

/** The shelf with `id` just before `before` (`null`: the end); undefined when nothing moves. */
function moved(
    items: readonly SavedPrompt[],
    id: string,
    before: string | null
): SavedPrompt[] | undefined {
    const item = items.find(row => row.id === id);
    if (!item || before === id) return undefined;
    const others = items.filter(row => row !== item);
    const index = before === null ? others.length : others.findIndex(row => row.id === before);
    if (index === -1) return undefined;
    const result = [...others.slice(0, index), item, ...others.slice(index)];
    return result.every((row, at) => row === items[at]) ? undefined : result;
}

/**
 * The `before` that moves `id` to `place`: the first prompt, the one before it, or the one
 * two after it (`null`: the end). Undefined when `id` is not on the shelf or already there.
 */
export function beforeFor(
    items: readonly SavedPrompt[],
    id: string,
    place: ShelfPlace
): string | null | undefined {
    const index = items.findIndex(item => item.id === id);
    if (index === -1) return undefined;
    if (place === 'later') {
        return index < items.length - 1 ? (items[index + 2]?.id ?? null) : undefined;
    }
    if (index === 0) return undefined;
    return place === 'first' ? items[0].id : items[index - 1].id;
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function inaccessible(error: SavedReportsError): boolean {
    return error === 'forbidden' || error === 'unauthorized' || error === 'book_not_found';
}

function reason(error: unknown): SavedReportsError {
    if (error instanceof AppApiError) {
        switch (error.code) {
            case 'unauthorized':
            case 'forbidden':
            case 'book_not_found':
            case 'invalid_request':
            case 'storage_error':
            case 'upstream_error':
            case 'report_not_found':
            case 'shelf_changed':
                return error.code;
        }
    }
    return 'unexpected';
}
