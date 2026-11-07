import { NameIndex, type NameCompletion } from 'report-shared/name-index';
import { AppApiError, type AppApi, type BookName } from '../api/app-api';
import { isFresh } from './cache-window';
import { reactive, Store } from './store';

export type BookNamesApi = Pick<AppApi, 'names'>;

export interface BookNamesOptions {
    /** The clock of the minute the names are reused for; by default `Date.now`. */
    now?: () => number;
    logger?: Pick<Console, 'error'>;
}

const EMPTY = new NameIndex([]);

/**
 * The names of the open Book's groups and accounts, indexed to complete requests as they are
 * typed: completing reads only memory, never the network. They load in the background when a
 * Book opens and come from the Book's map, which the Worker keeps for a minute: once they are
 * older than {@link CACHE_MS}, {@link refresh} asks for them again, once, and the names known
 * stay until new ones arrive, and when asking fails. Another Book starts over, and answers for
 * the Book before are dropped.
 */
export class BookNames extends Store {
    @reactive bookId?: string;
    /** The open Book's names; empty until they arrive. */
    @reactive index: NameIndex = EMPTY;
    /** Settles when the names asked for last arrive or fail. */
    loaded: Promise<void> = Promise.resolve();

    private names?: readonly BookName[];
    private session = 0;
    private request?: AbortController;
    /** When the names were last asked for, answered or not. */
    private askedAt?: number;
    private readonly now: () => number;
    private readonly logger: Pick<Console, 'error'>;

    constructor(
        private readonly api: BookNamesApi,
        options: BookNamesOptions = {}
    ) {
        super();
        this.now = options.now ?? Date.now;
        this.logger = options.logger ?? console;
    }

    /** Open a Book, or none: its names load in the background; the same Book changes nothing. */
    open(bookId: string | undefined): void {
        if (bookId === this.bookId) return;
        this.session++;
        this.request?.abort();
        this.request = undefined;
        this.askedAt = undefined;
        this.names = undefined;
        this.bookId = bookId;
        this.index = EMPTY;
        if (bookId) this.load(bookId);
    }

    /** Ask for the names again once they are older than a minute, and not already on their way. */
    refresh(): void {
        if (!this.bookId || this.request || this.askedAt === undefined) return;
        if (!isFresh(this.askedAt, this.now())) this.load(this.bookId);
    }

    /** The names completing `text` at `caret`, best first; from memory only. */
    complete(text: string, caret: number): NameCompletion[] {
        return this.index.complete(text, caret);
    }

    private load(bookId: string): void {
        const session = this.session;
        const controller = new AbortController();
        this.request = controller;
        this.askedAt = this.now();
        this.loaded = this.api.names(bookId, { signal: controller.signal }).then(
            names => {
                if (session !== this.session) return;
                this.request = undefined;
                if (this.names && sameNames(this.names, names)) return;
                this.names = names;
                this.index = new NameIndex(names);
            },
            (error: unknown) => {
                if (session !== this.session || isAbort(error)) return;
                this.request = undefined;
                if (inaccessible(error)) {
                    this.names = undefined;
                    this.index = EMPTY;
                    return;
                }
                // Without new names, the names known stay: completing is a help, not a report.
                this.logger.error("Error loading the Book's names:", error);
            }
        );
    }
}

function sameNames(a: readonly BookName[], b: readonly BookName[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (name, i) =>
                name.id === b[i].id &&
                name.name === b[i].name &&
                name.kind === b[i].kind &&
                name.root === b[i].root
        )
    );
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function inaccessible(error: unknown): boolean {
    return (
        error instanceof AppApiError &&
        (error.code === 'forbidden' ||
            error.code === 'unauthorized' ||
            error.code === 'book_not_found')
    );
}
