import {
    AppApiError,
    type AppApi,
    type SavedPrompt,
    type SavedPromptCapabilities,
} from '../api/app-api';
import { reactive, Store } from './store';

export type SavedReportsApi = Pick<AppApi, 'savedReports' | 'saveReport' | 'removeReport'>;

/** Stable reasons for the future UI to localize; never expose upstream messages or prompts. */
export type SavedReportsError =
    | 'unauthorized'
    | 'forbidden'
    | 'book_not_found'
    | 'invalid_request'
    | 'storage_error'
    | 'upstream_error'
    | 'unexpected';

/**
 * The active Book's shared shelf of original prompts, not computed reports. Switching Books
 * drops all state and reloads capabilities. These are UI hints only: the server authorizes
 * every request afresh. Nothing is persisted in the browser.
 */
export class SavedReports extends Store {
    @reactive bookId?: string;
    @reactive items: readonly SavedPrompt[] = [];
    @reactive capabilities?: SavedPromptCapabilities;
    @reactive loading = false;
    /** The prompt/id whose mutation is pending; at most one mutation runs at a time. */
    @reactive saving?: string;
    @reactive removing?: string;
    @reactive loadError?: SavedReportsError;
    @reactive saveError?: SavedReportsError;
    @reactive removeError?: SavedReportsError;
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
        return (
            this.capabilities?.save === true &&
            this.source !== undefined &&
            this.saving === undefined &&
            this.removing === undefined
        );
    }
    get canRemove(): boolean {
        return (
            this.capabilities?.remove === true &&
            this.saving === undefined &&
            this.removing === undefined
        );
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
        this.loadError = undefined;
        this.saveError = undefined;
        this.removeError = undefined;
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
                    this.items = ordered(result.reports);
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
                this.items = ordered([...this.items.filter(row => row.id !== item.id), item]);
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

    private mutate(
        operation: 'save' | 'remove',
        value: string,
        request: (signal: AbortSignal) => Promise<() => void>
    ): Promise<void> {
        // A list already in flight must not undo a confirmed local save/removal, nor replace
        // its capabilities. Later explicit reloads still follow the server's eventual KV view.
        this.cancelLoad();
        const controller = new AbortController();
        const session = this.session;
        if (operation === 'save') this.saving = value;
        else this.removing = value;
        const promise = request(controller.signal)
            .then(
                apply => {
                    if (session !== this.session || controller.signal.aborted) return;
                    apply();
                },
                (error: unknown) => {
                    if (session !== this.session || controller.signal.aborted || isAbort(error))
                        return;
                    const failure = reason(error);
                    if (operation === 'save') this.saveError = failure;
                    else this.removeError = failure;
                    if (failure === 'forbidden' && this.capabilities) {
                        this.capabilities = { ...this.capabilities, save: false, remove: false };
                    } else if (inaccessible(failure)) {
                        this.capabilities = undefined;
                        this.items = [];
                    }
                }
            )
            .finally(() => {
                if (session !== this.session || controller.signal.aborted) return;
                this.mutation = undefined;
                this.saving = undefined;
                this.removing = undefined;
            });
        this.mutation = { controller, promise };
        return promise;
    }

    private cancelLoad(): void {
        this.listRequest?.controller.abort();
        this.listRequest = undefined;
        this.loading = false;
    }
}

function ordered(items: readonly SavedPrompt[]): SavedPrompt[] {
    return [...new Map(items.map(item => [item.id, item])).values()].sort((a, b) =>
        a.id.localeCompare(b.id)
    );
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
                return error.code;
        }
    }
    return 'unexpected';
}
