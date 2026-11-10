import { reportText, type ReportState } from 'report-shared/report-state';
import type { StringKey } from 'report-shared/strings';
import {
    AppApiError,
    type AppApi,
    type BookProblem,
    type ReportIntent,
    type ReportRequest,
    type ReportResponse,
    type Suggestion,
} from '../api/app-api';
import { CACHE_MS, isFresh } from './cache-window';
import type { Route } from './route';
import { reactive, Store } from './store';

/** How long typing pauses before the request goes out. */
export const DEBOUNCE_MS = 250;
/** Requests shorter than this many words wait for Enter: one word is rarely a report yet. */
export const MIN_WORDS = 2;
/**
 * The event that asks the input to show the request selected, so the first keystroke replaces
 * it: the request was opened for the person, not by them.
 */
export const SELECT_TEXT = 'select-text';

export type ReportApi = Pick<AppApi, 'suggestions' | 'report'>;

/** A way to show a report: one of its charts, or `table` for none. */
export type ChartKind = ReportResponse['trace']['chart']['main'];

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
    unknown_target: 'error_unknown_target',
    mixed_targets: 'error_mixed_targets',
    no_net_result: 'error_no_net_result',
    upstream_error: 'error_upstream',
};

/**
 * Notices that the suggestions answer: they are reports of this Book, opened with no AI and
 * listed even when Bkper AI is unavailable (in Book order).
 */
const SUGGESTING: ReadonlySet<Notice> = new Set([
    'hint_not_a_report',
    'error_ai_allowance_exhausted',
]);

export interface ReportsOptions {
    /** The language of the interface, for the suggestions and the reports they ask for. */
    language: string;
    logger: Pick<Console, 'error'>;
    /** The clock of the caches, in milliseconds; by default `Date.now`, which runs through sleep. */
    now?: () => number;
}

/** A report asked for, shared by everyone who asks the same; `value` once it answers. */
interface Entry {
    promise: Promise<ReportResponse>;
    value?: ReportResponse;
    /** Only a request actually made by prompt has an original prompt. */
    prompt?: string;
    /** When it was asked for: it is reused for {@link CACHE_MS}. */
    at: number;
}

/**
 * The report of the open Book and the request typed for it.
 *
 * A request goes out {@link DEBOUNCE_MS} after the last keystroke once it has {@link MIN_WORDS}
 * words, or at once on Enter. A newer request cancels the one in flight, and only the latest
 * answer is shown; the last report stays until then. Reports are remembered by request and by
 * intent for {@link CACHE_MS}, saved requests too, and the suggestions' reports are fetched as
 * soon as the suggestions arrive, so choosing one shows it from memory. The suggestions come
 * from the Book's map: the first request after {@link CACHE_MS} asks them again.
 */
export class Reports extends Store {
    /** The request, as typed. */
    @reactive text = '';
    /** The last report that answered: shown until another one does. */
    @reactive report?: ReportResponse;
    @reactive private source?: { report: ReportResponse; prompt: string };
    /**
     * The chart the person chose, from its previews, and the report it is for: it holds the
     * report, so showing another report drops the choice in the same change.
     */
    @reactive private choice?: { report: ReportResponse; kind: ChartKind };
    /** A request is on its way. */
    @reactive pending = false;
    @reactive notice?: Notice;
    /** What keeps the Book from the report asked for: its message, until the next request. */
    @reactive private requestProblem?: BookProblem;
    /** What keeps the Book from having any report, as its suggestions say. */
    @reactive private bookProblem?: BookProblem;
    /** Reports the Book can have; `undefined` while they load. */
    @reactive suggestions?: Suggestion[];

    private openBookId?: string;
    /** Nothing was asked of the open Book yet: no request typed, sent or chosen, no state shown. */
    private nothingAsked = false;
    private cache = new Map<string, Entry>();
    /** Identifies the latest request: an answer to any other is stale. */
    private sequence = 0;
    private inFlight?: { key: string; controller: AbortController };
    private timer?: ReturnType<typeof setTimeout>;
    private suggestionsRequest?: AbortController;
    /** When the suggestions were last asked for. */
    private suggestionsAt?: number;
    private readonly now: () => number;

    constructor(
        private readonly api: ReportApi,
        private readonly route: Route,
        private readonly options: ReportsOptions
    ) {
        super();
        this.now = options.now ?? Date.now;
    }

    /** The chart the person chose for the report shown, from its previews; none for its main one. */
    get chart(): ChartKind | undefined {
        return this.choice?.report === this.report ? this.choice?.kind : undefined;
    }

    /** The original request that produced the shown report, never the input or a restored title. */
    get originalPrompt(): string | undefined {
        return this.source?.report === this.report ? this.source?.prompt : undefined;
    }

    get language(): string {
        return this.options.language;
    }

    /** The Book whose reports these are. */
    get bookId(): string | undefined {
        return this.openBookId;
    }

    /**
     * The open Book was opened with no request or state, and since then nothing was typed (even
     * a request cleared), sent, chosen or shown from a state.
     */
    get untouched(): boolean {
        return this.nothingAsked;
    }

    /** Ask the input to show the request selected (see {@link SELECT_TEXT}). */
    selectText(): void {
        this.dispatchEvent(new Event(SELECT_TEXT));
    }

    /**
     * What keeps the Book from its reports, shown in place of a notice: the problem of the last
     * request, else the Book's own while nothing else is said.
     */
    get problem(): BookProblem | undefined {
        return this.requestProblem ?? (this.notice ? undefined : this.bookProblem);
    }

    /** The suggestions show under an empty input, and with the notices they answer. */
    get showsSuggestions(): boolean {
        return (
            this.text.trim() === '' || (this.notice !== undefined && SUGGESTING.has(this.notice))
        );
    }

    /**
     * Start over for a Book, or none, and load its suggestions; show the report of `state` at
     * once, else run `prompt`.
     */
    open(bookId: string | undefined, prompt = '', state?: ReportState): void {
        this.cancel();
        this.suggestionsRequest?.abort();
        this.suggestionsRequest = undefined;
        this.suggestionsAt = undefined;
        this.openBookId = bookId;
        this.cache = new Map();
        this.report = undefined;
        this.source = undefined;
        this.choice = undefined;
        this.quiet();
        this.suggestions = undefined;
        this.bookProblem = undefined;
        this.text = prompt;
        this.nothingAsked = !!bookId && !state && !prompt.trim();
        if (!bookId) return;
        void this.loadSuggestions(bookId);
        if (state) this.openState(state);
        else if (prompt.trim()) this.run(prompt);
    }

    /**
     * Show the report of a state, such as one Bkper kept in the Book's URL, by its intent (no
     * AI), in its language; once it shows, the input holds its title and period.
     */
    openState(state: ReportState): void {
        this.nothingAsked = false;
        this.clearTimer();
        this.quiet();
        this.run('', state.intent, { language: state.language, label: true });
    }

    /** The person typed: keep the request in the URL and ask once typing pauses. */
    input(text: string): void {
        this.nothingAsked = false;
        this.text = text;
        this.route.setPrompt(text);
        this.quiet();
        this.clearTimer();
        if (wordCount(text) < MIN_WORDS) {
            this.cancel();
            return;
        }
        this.timer = setTimeout(() => this.run(this.text), DEBOUNCE_MS);
    }

    /** Enter: ask now. */
    submit(): void {
        this.nothingAsked = false;
        this.clearTimer();
        if (this.text.trim()) this.run(this.text);
    }

    /** A suggestion was chosen: show it as the request, and its report, by intent. */
    choose(suggestion: Suggestion): void {
        this.nothingAsked = false;
        this.clearTimer();
        this.text = suggestion.text;
        this.route.setPrompt(suggestion.text);
        this.quiet();
        this.run(suggestion.text, suggestion.intent);
    }

    /**
     * Open a saved original request: the report of exactly its text within {@link CACHE_MS},
     * else its text resolved again. Never a resolved intent, such as a suggestion's with the same
     * text, nor the report of another spacing or casing of it.
     */
    runSaved(prompt: string): void {
        this.nothingAsked = false;
        this.clearTimer();
        this.text = prompt;
        this.route.setPrompt(prompt);
        this.quiet();
        if (prompt.trim()) this.run(prompt, undefined, { saved: true });
    }

    /** The person chose another chart of the report shown: it shows with no new request. */
    chooseChart(kind: ChartKind): void {
        const report = this.report;
        if (!report) return;
        this.choice = kind === report.trace.chart.main ? undefined : { report, kind };
    }

    /** Something outside the requests failed, such as loading the report renderer. */
    fail(notice: Notice): void {
        this.quiet();
        this.notice = notice;
    }

    /** Say nothing: no notice and no problem of a request. */
    private quiet(): void {
        this.notice = undefined;
        this.requestProblem = undefined;
    }

    /**
     * Ask for the report of `text`, or of `intent` in `language` (by default the interface's);
     * with `label`, the input then holds the report's title and period.
     */
    private run(
        text: string,
        intent?: ReportIntent,
        {
            language = this.language,
            label = false,
            saved = false,
        }: {
            language?: string;
            label?: boolean;
            saved?: boolean;
        } = {}
    ): void {
        const bookId = this.openBookId;
        if (!bookId) return;
        this.refreshSuggestions(bookId);
        const key = intent ? intentKey(intent, language) : promptKey(text);
        const remembered = this.remembered(key);
        // A saved request is its exact text, so its source stays that text.
        const cached = saved && remembered?.prompt !== text.trim() ? undefined : remembered;
        // The label replaces only the text the report was asked with, never later typing.
        const labelFor = label ? this.text : undefined;
        if (cached?.value) {
            this.cancel();
            this.show(cached.value, intent ? undefined : cached.prompt, labelFor);
            return;
        }
        if (this.inFlight?.key === key && (cached || !saved)) return;
        this.cancel();
        const sequence = this.sequence;
        let entry = cached;
        if (!entry) {
            const controller = new AbortController();
            const body: ReportRequest = intent ? { intent, language } : { prompt: text.trim() };
            entry = this.request(key, bookId, body, controller.signal);
            this.inFlight = { key, controller };
        }
        const originalPrompt = intent ? undefined : entry.prompt;
        this.pending = true;
        entry.promise.then(
            report => {
                if (sequence !== this.sequence) return;
                this.inFlight = undefined;
                this.show(report, originalPrompt, labelFor);
            },
            (error: unknown) => {
                if (sequence !== this.sequence) return;
                this.inFlight = undefined;
                this.pending = false;
                this.failed(error);
            }
        );
    }

    /**
     * Ask the API, remembering the answer by request and by intent for {@link CACHE_MS} from
     * now; failures are forgotten.
     */
    private request(key: string, bookId: string, body: ReportRequest, signal?: AbortSignal): Entry {
        this.forgetExpired();
        const cache = this.cache;
        const entry: Entry = {
            prompt: body.prompt,
            at: this.now(),
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

    /** The report remembered under `key`, while it is fresh; an expired one is forgotten. */
    private remembered(key: string): Entry | undefined {
        const entry = this.cache.get(key);
        if (!entry || this.fresh(entry.at)) return entry;
        this.cache.delete(key);
        return undefined;
    }

    private forgetExpired(): void {
        for (const [key, entry] of this.cache) if (!this.fresh(entry.at)) this.cache.delete(key);
    }

    private fresh(at: number): boolean {
        return isFresh(at, this.now());
    }

    /** Show a report; when the input still holds `labelFor`, its title and period replace it. */
    private show(report: ReportResponse, prompt?: string, labelFor?: string): void {
        this.source = prompt === undefined ? undefined : { report, prompt };
        this.pending = false;
        this.quiet();
        // The report first: its chart is then its main one, and dropping the choice changes nothing.
        this.report = report;
        this.choice = undefined;
        if (labelFor !== undefined && this.text === labelFor) this.text = reportText(report.spec);
    }

    private failed(error: unknown): void {
        if (isAbort(error)) return;
        this.quiet();
        if (error instanceof AppApiError) {
            if (error.problem) {
                this.requestProblem = error.problem;
                return;
            }
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

    /** Ask the suggestions again once they are older than {@link CACHE_MS}, and not on their way. */
    private refreshSuggestions(bookId: string): void {
        if (this.suggestionsRequest || this.suggestionsAt === undefined) return;
        if (!this.fresh(this.suggestionsAt)) void this.loadSuggestions(bookId);
    }

    /**
     * Load the suggestions, then fetch their reports so choosing one is instant. Asked again,
     * the suggestions shown stay until new ones arrive, and stay if those fail.
     */
    private async loadSuggestions(bookId: string): Promise<void> {
        const controller = new AbortController();
        const again = this.suggestions !== undefined;
        this.suggestionsRequest = controller;
        this.suggestionsAt = this.now();
        try {
            const { suggestions, problem } = await this.api.suggestions(bookId, {
                language: this.language,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            this.suggestions = suggestions;
            this.bookProblem = problem;
            for (const suggestion of suggestions) this.prefetch(bookId, suggestion);
        } catch (error) {
            if (controller.signal.aborted || isAbort(error) || again) return;
            this.suggestions = [];
            this.failed(error);
        } finally {
            if (this.suggestionsRequest === controller) this.suggestionsRequest = undefined;
        }
    }

    private prefetch(bookId: string, suggestion: Suggestion): void {
        const key = intentKey(suggestion.intent, this.language);
        const entry =
            this.remembered(key) ??
            this.request(key, bookId, { intent: suggestion.intent, language: this.language });
        // The text of a suggestion asks for its report too.
        const textKey = promptKey(suggestion.text);
        const cache = this.cache;
        if (!this.remembered(textKey)) cache.set(textKey, entry);
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

/**
 * A request by its words, however spaced. Case stays: it tells apart names of the Book written
 * alike but for it, as the Worker reads them (`report-shared/names`).
 */
function promptKey(text: string): string {
    return `prompt:${text.trim().replace(/\s+/g, ' ')}`;
}

function intentKey(intent: ReportIntent, language: string): string {
    const { root, target, alongside, period, compared, monthly, view, hashtags } = intent;
    const tags = hashtags?.length ? [...hashtags].sort() : undefined;
    // No chart is the same as `auto`, and no comparison the same as the previous period.
    const chart = intent.chart === 'auto' ? undefined : intent.chart;
    const compareWith = intent.compareWith === 'year_earlier' ? 'year_earlier' : null;
    const parts = [
        root,
        target ?? null,
        // In order: the targets side by side show in it.
        alongside?.map(subject => [subject.root, subject.target ?? null]) ?? null,
        typeof period === 'string' ? period : periodKey(period),
        compared ? periodKey(compared) : null,
        compareWith,
        monthly,
        view ?? null,
        tags ?? null,
        chart ?? null,
    ];
    return `intent:${language}:${JSON.stringify(parts)}`;
}

/** The parts of a period in one order, whatever order they were written in. */
function periodKey(parts: Exclude<ReportIntent['period'], string>): unknown[] {
    return [
        'span' in parts ? (parts.span ?? null) : null,
        parts.year ?? null,
        parts.month ?? null,
        parts.quarter ?? null,
    ];
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
