import type { StringKey } from 'report-shared/strings';
import {
    AppApiError,
    type AppApi,
    type ReportIntent,
    type ReportRequest,
    type ReportResponse,
    type Suggestion,
} from '../api/app-api';
import type { Route } from './route';
import { reactive, Store } from './store';

/** How long typing pauses before the request goes out. */
export const DEBOUNCE_MS = 250;
/** Requests shorter than this many words wait for Enter: one word is rarely a report yet. */
export const MIN_WORDS = 2;

export type ReportApi = Pick<AppApi, 'suggestions' | 'report'>;

/** The message shown under the input: a quiet hint or what went wrong, as a string key. */
export type Notice = Extract<StringKey, 'hint_not_a_report' | `error_${string}`>;

/** The notice of each API error code; any other failure is `error_unexpected`. */
const NOTICES: Partial<Record<string, Notice>> = {
    not_a_report: 'hint_not_a_report',
    ai_allowance_exhausted: 'error_ai_allowance_exhausted',
    book_not_found: 'error_book_not_found',
    forbidden: 'error_forbidden',
    future_period: 'error_future_period',
    unknown_root: 'error_unknown_root',
    upstream_error: 'error_upstream',
};

/** Notices that the suggestions answer: they need no AI and are reports of this Book. */
const SUGGESTING: ReadonlySet<Notice> = new Set([
    'hint_not_a_report',
    'error_ai_allowance_exhausted',
]);

export interface ReportsOptions {
    /** The language of the interface, for the suggestions and the reports they ask for. */
    language: string;
    logger: Pick<Console, 'error'>;
}

/** A report asked for, shared by everyone who asks the same; `value` once it answers. */
interface Entry {
    promise: Promise<ReportResponse>;
    value?: ReportResponse;
}

/**
 * The report of the open Book and the request typed for it.
 *
 * A request goes out {@link DEBOUNCE_MS} after the last keystroke once it has {@link MIN_WORDS}
 * words, or at once on Enter. A newer request cancels the one in flight, and only the latest
 * answer is shown; the last report stays until then. Reports are remembered by request and by
 * intent, and the suggestions' reports are fetched as soon as the suggestions arrive, so
 * choosing one shows it from memory.
 */
export class Reports extends Store {
    /** The request, as typed. */
    @reactive text = '';
    /** The last report that answered: shown until another one does. */
    @reactive report?: ReportResponse;
    /** A request is on its way. */
    @reactive pending = false;
    @reactive notice?: Notice;
    /** Reports the Book can have; `undefined` while they load. */
    @reactive suggestions?: Suggestion[];

    private bookId?: string;
    private cache = new Map<string, Entry>();
    /** Identifies the latest request: an answer to any other is stale. */
    private sequence = 0;
    private inFlight?: { key: string; controller: AbortController };
    private timer?: ReturnType<typeof setTimeout>;
    private suggestionsRequest?: AbortController;

    constructor(
        private readonly api: ReportApi,
        private readonly route: Route,
        private readonly options: ReportsOptions
    ) {
        super();
    }

    get language(): string {
        return this.options.language;
    }

    /** The suggestions show under an empty input, and with the notices they answer. */
    get showsSuggestions(): boolean {
        return (
            this.text.trim() === '' || (this.notice !== undefined && SUGGESTING.has(this.notice))
        );
    }

    /** Start over for a Book, or none, running `prompt` at once, and load its suggestions. */
    open(bookId: string | undefined, prompt = ''): void {
        this.cancel();
        this.suggestionsRequest?.abort();
        this.suggestionsRequest = undefined;
        this.bookId = bookId;
        this.cache = new Map();
        this.report = undefined;
        this.notice = undefined;
        this.suggestions = undefined;
        this.text = prompt;
        if (!bookId) return;
        void this.loadSuggestions(bookId);
        if (prompt.trim()) this.run(prompt);
    }

    /** The person typed: keep the request in the URL and ask once typing pauses. */
    input(text: string): void {
        this.text = text;
        this.route.setPrompt(text);
        this.notice = undefined;
        this.clearTimer();
        if (wordCount(text) < MIN_WORDS) {
            this.cancel();
            return;
        }
        this.timer = setTimeout(() => this.run(this.text), DEBOUNCE_MS);
    }

    /** Enter: ask now. */
    submit(): void {
        this.clearTimer();
        if (this.text.trim()) this.run(this.text);
    }

    /** A suggestion was chosen: show it as the request, and its report, by intent. */
    choose(suggestion: Suggestion): void {
        this.clearTimer();
        this.text = suggestion.text;
        this.route.setPrompt(suggestion.text);
        this.notice = undefined;
        this.run(suggestion.text, suggestion.intent);
    }

    /** Something outside the requests failed, such as loading the report renderer. */
    fail(notice: Notice): void {
        this.notice = notice;
    }

    private run(text: string, intent?: ReportIntent): void {
        const bookId = this.bookId;
        if (!bookId) return;
        const key = intent ? intentKey(intent, this.language) : promptKey(text);
        const cached = this.cache.get(key);
        if (cached?.value) {
            this.cancel();
            this.show(cached.value);
            return;
        }
        if (this.inFlight?.key === key) return;
        this.cancel();
        const sequence = this.sequence;
        let entry = cached;
        if (!entry) {
            const controller = new AbortController();
            const body: ReportRequest = intent
                ? { intent, language: this.language }
                : { prompt: text.trim() };
            entry = this.request(key, bookId, body, controller.signal);
            this.inFlight = { key, controller };
        }
        this.pending = true;
        entry.promise.then(
            report => {
                if (sequence !== this.sequence) return;
                this.inFlight = undefined;
                this.show(report);
            },
            (error: unknown) => {
                if (sequence !== this.sequence) return;
                this.inFlight = undefined;
                this.pending = false;
                this.failed(error);
            }
        );
    }

    /** Ask the API, remembering the answer by request and by intent; failures are forgotten. */
    private request(key: string, bookId: string, body: ReportRequest, signal?: AbortSignal): Entry {
        const cache = this.cache;
        const entry: Entry = {
            promise: this.api.report(bookId, body, { signal }).then(
                report => {
                    entry.value = report;
                    cache.set(intentKey(report.intent, report.language), entry);
                    return report;
                },
                (error: unknown) => {
                    if (cache.get(key) === entry) cache.delete(key);
                    throw error;
                }
            ),
        };
        cache.set(key, entry);
        return entry;
    }

    private show(report: ReportResponse): void {
        this.pending = false;
        this.notice = undefined;
        this.report = report;
    }

    private failed(error: unknown): void {
        if (isAbort(error)) return;
        if (error instanceof AppApiError) {
            if (error.suggestions?.length) this.suggestions = error.suggestions;
            const notice = error.code ? NOTICES[error.code] : undefined;
            if (notice) {
                this.notice = notice;
                return;
            }
        }
        this.options.logger.error('Error building the report:', error);
        this.notice = 'error_unexpected';
    }

    /** Load the suggestions, then fetch their reports so choosing one is instant. */
    private async loadSuggestions(bookId: string): Promise<void> {
        const controller = new AbortController();
        this.suggestionsRequest = controller;
        try {
            const suggestions = await this.api.suggestions(bookId, {
                language: this.language,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            this.suggestions = suggestions;
            for (const suggestion of suggestions) this.prefetch(bookId, suggestion);
        } catch (error) {
            if (controller.signal.aborted || isAbort(error)) return;
            this.suggestions = [];
            this.failed(error);
        }
    }

    private prefetch(bookId: string, suggestion: Suggestion): void {
        const key = intentKey(suggestion.intent, this.language);
        const entry =
            this.cache.get(key) ??
            this.request(key, bookId, { intent: suggestion.intent, language: this.language });
        // The text of a suggestion asks for its report too.
        const textKey = promptKey(suggestion.text);
        const cache = this.cache;
        if (!cache.has(textKey)) cache.set(textKey, entry);
        entry.promise.catch(() => {
            if (cache.get(textKey) === entry) cache.delete(textKey);
        });
    }

    /** Stop waiting: abort the request in flight and drop any answer still to come. */
    private cancel(): void {
        this.clearTimer();
        this.sequence++;
        if (this.inFlight) {
            this.inFlight.controller.abort();
            // Forget it now, so asking the same again sends a new request.
            if (!this.cache.get(this.inFlight.key)?.value) this.cache.delete(this.inFlight.key);
            this.inFlight = undefined;
        }
        this.pending = false;
    }

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }
}

const segmenter =
    typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : undefined;

/** Words of any language, including those written without spaces, such as Japanese. */
export function wordCount(text: string): number {
    if (!segmenter) return text.trim().split(/\s+/).filter(Boolean).length;
    let count = 0;
    for (const segment of segmenter.segment(text)) if (segment.isWordLike) count++;
    return count;
}

function promptKey(text: string): string {
    return `prompt:${text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
}

function intentKey(intent: ReportIntent, language: string): string {
    const { root, period, monthly, view, hashtags } = intent;
    const tags = hashtags?.length ? [...hashtags].sort() : undefined;
    // No chart is the same as `auto`.
    const chart = intent.chart === 'auto' ? undefined : intent.chart;
    const parts = [root, period, monthly, view ?? null, tags ?? null, chart ?? null];
    return `intent:${language}:${JSON.stringify(parts)}`;
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
