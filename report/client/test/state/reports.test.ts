import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AppApiError,
    type BookProblem,
    type ReportRequest,
    type ReportResponse,
} from '../../src/api/app-api';
import { CACHE_MS } from '../../src/state/cache-window';
import type { StateChart } from 'report-shared/url-state';
import {
    DEBOUNCE_MS,
    Reports,
    SELECT_TEXT,
    type ChartKind,
    type ReportApi,
} from '../../src/state/reports';
import { Route, type RoutePage } from '../../src/state/route';

function createPage(href: string): RoutePage {
    const page: RoutePage = {
        location: { href },
        history: {
            state: null,
            pushState: (_data, _unused, url) => void (page.location.href = String(url)),
            replaceState: (_data, _unused, url) => void (page.location.href = String(url)),
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
    return page;
}

function response(title: string, subtitle = ''): ReportResponse {
    return {
        spec: {
            root: 'report',
            elements: {
                report: {
                    type: 'Report',
                    props: { title, subtitle, locale: 'en', dir: 'ltr', fractionDigits: 2 },
                    children: [],
                },
            },
        },
        text: subtitle ? `${title} ${subtitle}` : title,
        language: 'en',
        query: 'q',
        dataAt: '2026-11-05T00:00:00Z',
        chart: { kind: 'none', fallback: false },
        url: 'https://report.bkper.app/',
    };
}

const SUGGESTIONS = ['Net result in 2011', 'Despesas by month in 2011', 'Investidores today'];

/** A report opened by state: its text, in its language. */
const NET = { text: 'Net result in 2011', language: 'pt' };

interface Call {
    bookId: string;
    body: ReportRequest;
    signal?: AbortSignal;
    resolve(value: ReportResponse): void;
    reject(reason: unknown): void;
}

/** An API whose report requests answer only when a test says so; suggestions answer at once. */
function createApi(suggestions: string[] = SUGGESTIONS, problem?: BookProblem) {
    const calls: Call[] = [];
    const suggestionCalls: { bookId: string; language?: string }[] = [];
    /** What the next suggestions requests answer, in order; then `suggestions`. */
    const nextSuggestions: (() => Promise<string[]>)[] = [];
    const api: ReportApi = {
        suggestions: async (bookId, options) => {
            suggestionCalls.push({ bookId, language: options.language });
            const next = (await nextSuggestions.shift()?.()) ?? suggestions;
            return problem ? { suggestions: next, problem } : { suggestions: next };
        },
        report: (bookId, body, options) =>
            new Promise((resolve, reject) => {
                calls.push({ bookId, body, signal: options.signal, resolve, reject });
            }),
    };
    /** Requests typed or saved: in the language the Worker detects. */
    const prompts = () =>
        calls.flatMap(call => (call.body.prompt && !call.body.language ? [call.body.prompt] : []));
    /** Requests of a suggestion's text, in the interface's language. */
    const suggested = () => calls.filter(call => call.body.prompt && call.body.language);
    return { api, calls, prompts, suggested, suggestionCalls, nextSuggestions };
}

function createReports(href = 'https://report.bkper.app/?book=book-1', api = createApi()) {
    const page = createPage(href);
    const route = new Route(page, false);
    // A fake clock of the client caches: tests move it with `tick`.
    const clock = { now: 1_000_000 };
    const reports = new Reports(api.api, route, {
        language: 'pt',
        logger: { error: () => {} },
        now: () => clock.now,
    });
    const tick = (ms: number) => void (clock.now += ms);
    return { reports, route, page, clock, tick, ...api };
}

/** Let resolved promises run their continuations. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('Reports', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it(`asks for a report ${DEBOUNCE_MS} ms after the last keystroke`, async () => {
        const { reports, prompts } = createReports();
        reports.open('book-1');

        reports.input('net');
        reports.input('net res');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
        reports.input('net result 2011');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
        expect(prompts()).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(prompts()).toEqual(['net result 2011']);
        expect(reports.pending).toBe(true);
    });

    it('waits for two words, counting words of languages written without spaces', async () => {
        const { reports, prompts } = createReports();
        reports.open('book-1');

        reports.input('despesas');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
        expect(prompts()).toEqual([]);

        reports.input('今年の経費');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        expect(prompts()).toEqual(['今年の経費']);
    });

    it('asks at once on Enter, even for one word, and not again when the wait ends', async () => {
        const { reports, prompts } = createReports();
        reports.open('book-1');

        reports.input('despesas');
        reports.submit();
        expect(prompts()).toEqual(['despesas']);

        reports.input('despesas 2011');
        reports.submit();
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
        expect(prompts()).toEqual(['despesas', 'despesas 2011']);
    });

    it('cancels the request in flight when a newer one starts', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');

        reports.input('net result');
        reports.submit();
        reports.input('net result 2011');
        reports.submit();

        expect(calls[0].signal?.aborted).toBe(true);
        expect(calls[1].signal?.aborted).toBe(false);
    });

    it('drops a response that answers after a newer request', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();
        reports.input('net result 2011');
        reports.submit();

        calls[1].resolve(response('Newer'));
        await settle();
        calls[0].resolve(response('Older'));
        await settle();

        expect(reports.report?.spec.root).toBe('report');
        expect(title(reports.report)).toBe('Newer');
        expect(reports.pending).toBe(false);
    });

    it('keeps the last report visible while the next one is on its way', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();
        calls[0].resolve(response('First'));
        await settle();

        reports.input('net result 2011');
        reports.submit();

        expect(reports.pending).toBe(true);
        expect(title(reports.report)).toBe('First');
    });

    it('ignores an aborted request, without a notice', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();

        reports.input('');
        calls[0].reject(new DOMException('The operation was aborted.', 'AbortError'));
        await settle();

        expect(calls[0].signal?.aborted).toBe(true);
        expect(reports.pending).toBe(false);
        expect(reports.notice).toBeUndefined();
    });

    it('keeps the request in the URL and runs the one the URL opens with', async () => {
        const { reports, page, route, prompts } = createReports(
            'https://report.bkper.app/?book=book-1&q=despesas'
        );

        reports.open(route.bookId, route.prompt);
        expect(reports.text).toBe('despesas');
        expect(prompts()).toEqual(['despesas']);

        reports.input('despesas em 2011');
        expect(page.location.href).toBe('https://report.bkper.app/?book=book-1&q=despesas+em+2011');
    });

    it('shows the suggestions under an empty input, and hides them while typing', async () => {
        const { reports, suggestionCalls } = createReports();

        reports.open('book-1');
        expect(reports.suggestions).toBeUndefined();
        expect(reports.showsSuggestions).toBe(true);
        await settle();
        expect(suggestionCalls).toEqual([{ bookId: 'book-1', language: 'pt' }]);
        expect(reports.suggestions).toEqual(SUGGESTIONS);

        reports.input('net');
        expect(reports.showsSuggestions).toBe(false);
        reports.input(' ');
        expect(reports.showsSuggestions).toBe(true);
    });

    it('prefetches the suggested reports by their texts, so choosing one shows it from memory', async () => {
        const { reports, calls, suggested, page } = createReports();
        reports.open('book-1');
        await settle();

        expect(calls.map(call => call.body)).toEqual(
            SUGGESTIONS.map(text => ({ prompt: text, language: 'pt' }))
        );
        suggested().forEach((call, index) => call.resolve(response(`Suggestion ${index}`)));
        await settle();

        reports.choose(SUGGESTIONS[1]);

        expect(title(reports.report)).toBe('Suggestion 1');
        expect(reports.pending).toBe(false);
        expect(reports.text).toBe('Despesas by month in 2011');
        expect(page.location.href).toBe(
            'https://report.bkper.app/?book=book-1&q=Despesas+by+month+in+2011'
        );
        expect(calls).toHaveLength(3);
        // A suggestion is a request like any other.
        expect(reports.originalPrompt).toBe('Despesas by month in 2011');
    });

    it('asks for a suggestion chosen after its prefetch failed by its text, in the interface’s language', async () => {
        const { reports, calls, suggested } = createReports();
        reports.open('book-1');
        await settle();
        suggested()[1].reject(new AppApiError('Bkper failed', 502, 'upstream_error'));
        await settle();

        reports.choose(SUGGESTIONS[1]);

        expect(calls.at(-1)?.body).toEqual({ prompt: SUGGESTIONS[1], language: 'pt' });
        expect(reports.pending).toBe(true);
    });

    it('shows a suggestion chosen before its prefetch answers, without asking twice', async () => {
        const { reports, calls, suggested } = createReports();
        reports.open('book-1');
        await settle();

        reports.choose(SUGGESTIONS[0]);
        expect(reports.pending).toBe(true);
        suggested()[0].resolve(response('Net'));
        await settle();

        expect(title(reports.report)).toBe('Net');
        expect(calls).toHaveLength(3);
    });

    it('answers a request asked before from memory, however it is spaced', async () => {
        const { reports, calls, prompts } = createReports();
        reports.open('book-1');
        await settle();
        reports.input('net result 2011');
        reports.submit();
        calls.at(-1)?.resolve(response('Net'));
        await settle();
        reports.input('other report');
        reports.submit();

        reports.input('  net   result 2011 ');
        reports.submit();

        expect(title(reports.report)).toBe('Net');
        expect(reports.pending).toBe(false);
        expect(prompts()).toEqual(['net result 2011', 'other report']);
    });

    it('asks again for a request cased otherwise, as case tells names of the Book apart', async () => {
        const { reports, calls, prompts } = createReports();
        reports.open('book-1');
        await settle();
        // A Book with an Account Food and a group FOOD: each request names the one it writes.
        reports.input('Food last month');
        reports.submit();
        calls.at(-1)?.resolve(response('Food'));
        await settle();

        reports.input('FOOD last month');
        reports.submit();
        expect(prompts()).toEqual(['Food last month', 'FOOD last month']);
        calls.at(-1)?.resolve(response('FOOD'));
        await settle();
        expect(title(reports.report)).toBe('FOOD');
        expect(reports.originalPrompt).toBe('FOOD last month');
    });

    it('remembers reports of one text with different charts apart', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.openState(NET);
        calls[0].resolve({ ...response('Net'), language: 'pt' });
        await settle();

        reports.openState({ ...NET, chart: 'pie' });
        expect(calls).toHaveLength(2);
        expect(calls[1].body).toEqual({ prompt: NET.text, language: 'pt', chart: 'pie' });
        calls[1].resolve({ ...response('Pie'), language: 'pt' });
        await settle();
        expect(title(reports.report)).toBe('Pie');

        reports.openState(NET);
        expect(title(reports.report)).toBe('Net');
        // Typed, however spaced, it is the same request.
        reports.input('Net  result in 2011');
        reports.submit();
        expect(calls).toHaveLength(2);
        expect(title(reports.report)).toBe('Net');
    });

    it('answers a typed suggestion text from memory', async () => {
        const { reports, suggested, prompts } = createReports();
        reports.open('book-1');
        await settle();
        suggested().forEach((call, index) => call.resolve(response(`Suggestion ${index}`)));
        await settle();

        reports.input('Net result  in 2011');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

        expect(title(reports.report)).toBe('Suggestion 0');
        expect(prompts()).toEqual([]);
    });

    it('forgets a failed request, so asking again retries it', async () => {
        const { reports, calls, prompts } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();
        calls[0].reject(new AppApiError('Bkper failed', 502, 'upstream_error'));
        await settle();
        expect(reports.notice).toBe('error_upstream');

        reports.input('net result ');
        reports.submit();

        expect(prompts()).toEqual(['net result', 'net result']);
    });

    it('keeps the last report and hints with the suggestions when a request is not a report', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.input('net result');
        reports.submit();
        calls[0].resolve(response('Net'));
        await settle();

        reports.input('hello there');
        reports.submit();
        calls[1].reject(new AppApiError('Not a report', 422, 'not_a_report', SUGGESTIONS));
        await settle();

        expect(title(reports.report)).toBe('Net');
        expect(reports.notice).toBe('hint_not_a_report');
        expect(reports.suggestions).toEqual(SUGGESTIONS);
        expect(reports.showsSuggestions).toBe(true);

        reports.input('hello there!');
        expect(reports.notice).toBeUndefined();
        expect(reports.showsSuggestions).toBe(false);
    });

    it('says clearly when the Bkper AI allowance is used up, offering the suggestions', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();

        calls[0].reject(new AppApiError('Allowance', 429, 'ai_allowance_exhausted'));
        await settle();

        expect(reports.notice).toBe('error_ai_allowance_exhausted');
        expect(reports.showsSuggestions).toBe(true);
    });

    it('says the Book has no net result and how to give it one, keeping the last report', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.input('expenses this year');
        reports.submit();
        calls[0].resolve(response('Expenses'));
        await settle();

        reports.input('net result');
        reports.submit();
        calls[1].reject(new AppApiError('No net result', 422, 'no_net_result'));
        await settle();

        expect(reports.notice).toBe('error_no_net_result');
        expect(title(reports.report)).toBe('Expenses');
    });

    it('tells what keeps the Book from the report asked for, until the next request', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        const problem: BookProblem = {
            code: 'mixed_group',
            bookName: 'Acme',
            canOrganize: true,
            group: 'Everything',
        };
        reports.open('book-1');
        reports.input('expenses this year');
        reports.submit();
        calls[0].resolve(response('Expenses'));
        await settle();

        reports.input('everything this year');
        reports.submit();
        calls[1].reject(new AppApiError('Mixed', 422, 'mixed_group', undefined, problem));
        await settle();

        expect(reports.problem).toEqual(problem);
        expect(reports.notice).toBeUndefined();
        expect(title(reports.report)).toBe('Expenses');

        reports.input('everything this year!');
        expect(reports.problem).toBeUndefined();
    });

    it('tells the problem of a Book with no reports as it opens, while the person types', async () => {
        const problem: BookProblem = { code: 'empty_book', bookName: 'Acme', canOrganize: true };
        const { reports, calls } = createReports(undefined, createApi([], problem));
        reports.open('book-1');
        await settle();

        expect(reports.suggestions).toEqual([]);
        expect(reports.problem).toEqual(problem);

        reports.input('expenses this year');
        expect(reports.problem).toEqual(problem);
        reports.submit();
        calls[0].reject(new AppApiError('Empty', 422, 'empty_book', undefined, problem));
        await settle();
        expect(reports.problem).toEqual(problem);
        expect(reports.notice).toBeUndefined();

        // A failure of its own says what failed instead.
        reports.input('expenses this month');
        reports.submit();
        calls[1].reject(new AppApiError('Bkper failed', 502, 'upstream_error'));
        await settle();
        expect(reports.notice).toBe('error_upstream');
        expect(reports.problem).toBeUndefined();

        reports.open('book-2');
        expect(reports.problem).toBeUndefined();
    });

    it('says why balances and activity cannot be side by side', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1', '', { text: 'Despesas e Ativos', language: 'en' });
        calls[0].reject(new AppApiError('Mixed', 422, 'mixed_targets'));
        await settle();

        expect(reports.notice).toBe('error_mixed_targets');
    });

    it('shows a quiet message for other failures, never the error', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();

        calls[0].reject(new Error('Sensitive details'));
        await settle();

        expect(reports.notice).toBe('error_unexpected');
        expect(reports.pending).toBe(false);
    });

    it('opening another Book starts over, ignoring what the previous one answers', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('net result');
        reports.submit();

        reports.open('book-2');
        calls[0].resolve(response('Book 1'));
        await settle();

        expect(calls[0].signal?.aborted).toBe(true);
        expect(reports.report).toBeUndefined();
        expect(reports.text).toBe('');
    });

    it('keeps the chart chosen for the report shown, until another report shows', async () => {
        const { reports, calls } = createReports();
        reports.open('book-1');
        reports.input('despesas 2011');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        const report = withMain(response('Despesas', '2011'), 'bar');
        calls.at(-1)?.resolve(report);
        await settle();
        expect(reports.chart).toBeUndefined();

        reports.chooseChart('pie');
        expect(reports.chart).toBe('pie');
        expect(reports.report).toBe(report);
        // The main chart again is no choice.
        reports.chooseChart('bar');
        expect(reports.chart).toBeUndefined();

        reports.chooseChart('pie');
        reports.input('receitas 2011');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        // The chart stays while the next report is on its way.
        expect(reports.chart).toBe('pie');
        calls.at(-1)?.resolve(withMain(response('Receitas', '2011'), 'donut'));
        await settle();
        expect(reports.chart).toBeUndefined();
    });

    it('chooses no chart without a report', () => {
        const { reports } = createReports();
        reports.open('book-1');
        reports.chooseChart('pie');
        expect(reports.chart).toBeUndefined();
    });

    it('keeps only the original prompt of the shown output across chart changes and later typing', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.input('  Despesas   este ano  ');
        reports.submit();
        expect(reports.originalPrompt).toBeUndefined();
        calls[0].resolve(withMain(response('Despesas', '2026'), 'bar'));
        await settle();
        expect(reports.originalPrompt).toBe('Despesas   este ano');
        reports.chooseChart('pie');
        expect(reports.originalPrompt).toBe('Despesas   este ano');
        reports.input('Receitas este mês');
        reports.submit();
        expect(reports.originalPrompt).toBe('Despesas   este ano');
        calls[1].reject(new Error('failed'));
        await settle();
        expect(reports.originalPrompt).toBe('Despesas   este ano');
        reports.input('Receitas este mês');
        reports.submit();
        calls[2].resolve(withMain(response('Receitas'), 'bar'));
        await settle();
        expect(reports.originalPrompt).toBe('Receitas este mês');
        reports.open('book-2');
        expect(reports.originalPrompt).toBeUndefined();
    });

    it('takes a report opened by state as asked for with its text', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1', 'Untrusted URL text', NET);
        expect(reports.text).toBe(NET.text);
        calls[0].resolve(withMain(response('Net result', '2011'), 'bar'));
        await settle();
        expect(reports.originalPrompt).toBe(NET.text);
        reports.chooseChart('pie');
        expect(reports.originalPrompt).toBe(NET.text);
    });

    it('opens the report shown again by its text and language, as the chart shown', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1');
        expect(reports.reopen).toBeUndefined();
        reports.input('despesas em pizza');
        reports.submit();
        const asked = withMain(
            { ...response('Despesas', 'este ano'), language: 'pt' },
            'pie',
            'pie'
        );
        calls[0].resolve(asked);
        await settle();
        // Its text names no chart, so the chart asked for goes with it.
        expect(reports.reopen).toEqual({ text: 'Despesas este ano', language: 'pt', chart: 'pie' });
        reports.chooseChart('table');
        expect(reports.reopen).toEqual({
            text: 'Despesas este ano',
            language: 'pt',
            chart: 'table',
        });
        reports.chooseChart('pie');
        expect(reports.reopen?.chart).toBe('pie');

        reports.input('receitas este ano');
        reports.submit();
        calls[1].resolve(withMain(response('Receitas', 'este ano'), 'bar'));
        await settle();
        expect(reports.reopen).toEqual({ text: 'Receitas este ano', language: 'en' });
    });

    it('reuses a saved click’s report for a minute, then resolves its text again', async () => {
        const { reports, calls, prompts, tick } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.runSaved('Expenses last month');
        // A repeated click while it is on its way asks nothing more.
        reports.runSaved('Expenses last month');
        expect(prompts()).toEqual(['Expenses last month']);
        calls[0].resolve(withMain(response('October'), 'bar'));
        await settle();
        reports.chooseChart('pie');

        tick(CACHE_MS - 1);
        reports.runSaved('Expenses last month');
        expect(prompts()).toEqual(['Expenses last month']);
        expect(title(reports.report)).toBe('October');
        expect(reports.chart).toBeUndefined();
        expect(reports.originalPrompt).toBe('Expenses last month');
        // Typing the saved text answers from the same memory.
        reports.input(' Expenses  last month');
        reports.submit();
        expect(calls).toHaveLength(1);

        tick(1);
        reports.runSaved('Expenses last month');
        expect(calls[1].body).toEqual({ prompt: 'Expenses last month' });
        expect(title(reports.report)).toBe('October');
        expect(reports.pending).toBe(true);
        calls[1].resolve(withMain(response('November'), 'bar'));
        await settle();
        expect(title(reports.report)).toBe('November');
        expect(reports.originalPrompt).toBe('Expenses last month');
    });

    it('reuses for a saved click only a report of the same text, a suggestion’s too, never other casing', async () => {
        const { reports, calls, suggested, prompts } = createReports();
        reports.open('book-1');
        await settle();
        suggested().forEach(call => call.resolve(withMain(response('Prefetched'), 'bar')));
        await settle();
        reports.choose(SUGGESTIONS[0]);
        reports.chooseChart('pie');

        // A suggestion's text asks for its report: the saved text is the same request.
        reports.runSaved(SUGGESTIONS[0]);
        expect(prompts()).toEqual([]);
        expect(title(reports.report)).toBe('Prefetched');
        expect(reports.chart).toBeUndefined();
        expect(reports.originalPrompt).toBe(SUGGESTIONS[0]);

        reports.input('expenses   THIS year');
        reports.submit();
        calls.at(-1)?.resolve(withMain(response('Typed'), 'bar'));
        await settle();
        reports.runSaved('Expenses this year');
        expect(prompts().slice(-2)).toEqual(['expenses   THIS year', 'Expenses this year']);
        calls.at(-1)?.resolve(withMain(response('Saved'), 'bar'));
        await settle();
        expect(title(reports.report)).toBe('Saved');
        expect(reports.originalPrompt).toBe('Expenses this year');
    });

    it('retries a failed saved execution, keeping the last report', async () => {
        const { reports, calls, prompts } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.input('Expenses this year');
        reports.submit();
        calls[0].resolve(withMain(response('Typed earlier'), 'bar'));
        await settle();
        reports.runSaved('Expenses this month');
        calls[1].reject(new AppApiError('not a report', 422, 'not_a_report'));
        await settle();
        expect(title(reports.report)).toBe('Typed earlier');
        expect(reports.notice).toBe('hint_not_a_report');
        reports.runSaved('Expenses this month');
        expect(prompts()).toEqual([
            'Expenses this year',
            'Expenses this month',
            'Expenses this month',
        ]);
        calls[2].resolve(withMain(response('Latest'), 'bar'));
        await settle();
        expect(title(reports.report)).toBe('Latest');
        expect(reports.notice).toBeUndefined();
    });

    it('retains a cached prompt result’s real source rather than later spacing or suggestion text', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('book-1');
        reports.input('Expenses   this year');
        reports.submit();
        calls[0].resolve(withMain(response('Expenses'), 'bar'));
        await settle();
        reports.input(' Expenses this year ');
        reports.submit();
        expect(calls).toHaveLength(1);
        expect(reports.originalPrompt).toBe('Expenses   this year');
    });

    it('cancels saved execution across Books without replaying its output or resolved intent', async () => {
        const { reports, calls } = createReports(undefined, createApi([]));
        reports.open('a');
        reports.runSaved('Expenses this year');
        const old = calls[0];
        reports.open('b');
        reports.runSaved('Expenses this year');
        calls[1].resolve(withMain(response('Book B'), 'bar'));
        await settle();
        old.resolve(withMain(response('Book A'), 'bar'));
        await settle();
        expect(old.signal?.aborted).toBe(true);
        expect(title(reports.report)).toBe('Book B');
        expect(calls[1].body).toEqual({ prompt: 'Expenses this year' });
        expect(reports.originalPrompt).toBe('Expenses this year');
    });

    describe('a minute of memory', () => {
        it(`shows a report from memory for ${CACHE_MS} ms, then asks again`, async () => {
            const { reports, calls, prompts, tick } = createReports(undefined, createApi([]));
            reports.open('book-1');
            reports.input('expenses this month');
            reports.submit();
            calls[0].resolve(response('Early'));
            await settle();

            tick(CACHE_MS - 1);
            reports.input('other report');
            reports.submit();
            reports.input('expenses  this month');
            reports.submit();
            expect(title(reports.report)).toBe('Early');
            expect(prompts()).toEqual(['expenses this month', 'other report']);

            tick(1);
            reports.input('expenses this month ');
            reports.submit();
            expect(prompts()).toEqual([
                'expenses this month',
                'other report',
                'expenses this month',
            ]);
            // The report stays on screen while the new one is on its way.
            expect(title(reports.report)).toBe('Early');
            expect(reports.pending).toBe(true);
            calls[2].resolve(response('Later'));
            await settle();
            expect(title(reports.report)).toBe('Later');
        });

        it('forgets the report of a state after a minute too', async () => {
            const { reports, calls, tick } = createReports(undefined, createApi([]));
            const state = NET;
            reports.open('book-1', '', state);
            calls[0].resolve(response('Despesas'));
            await settle();
            reports.openState(state);
            expect(calls).toHaveLength(1);

            tick(CACHE_MS);
            reports.openState(state);
            expect(calls).toHaveLength(2);
            expect(calls[1].body).toEqual({ prompt: NET.text, language: 'pt' });
        });

        it('shows a stale answer that arrives late once, but never reuses it', async () => {
            const { reports, calls, prompts, tick } = createReports(undefined, createApi([]));
            reports.open('book-1');
            reports.input('expenses this month');
            reports.submit();
            tick(CACHE_MS + 1);
            calls[0].resolve(response('Slow'));
            await settle();
            expect(title(reports.report)).toBe('Slow');

            reports.submit();
            expect(prompts()).toEqual(['expenses this month', 'expenses this month']);
        });

        it('treats a clock that went back as expired', async () => {
            const { reports, calls, tick } = createReports(undefined, createApi([]));
            reports.open('book-1');
            reports.input('expenses this month');
            reports.submit();
            calls[0].resolve(response('Before'));
            await settle();

            tick(-1);
            reports.submit();
            expect(calls).toHaveLength(2);
        });

        it('fetches prefetched suggestions afresh after a minute', async () => {
            const { reports, suggested, tick } = createReports();
            reports.open('book-1');
            await settle();
            suggested().forEach((call, index) => call.resolve(response(`Old ${index}`)));
            await settle();

            tick(CACHE_MS);
            reports.choose(SUGGESTIONS[1]);
            expect(reports.pending).toBe(true);
            expect(title(reports.report)).toBeUndefined();
            const fresh = suggested().filter(call => call.body.prompt === SUGGESTIONS[1]);
            expect(fresh).toHaveLength(2);
            fresh[1].resolve(response('New 1'));
            await settle();
            expect(title(reports.report)).toBe('New 1');
        });

        it('asks the suggestions of the Book’s map again after a minute, keeping them until they answer', async () => {
            const { reports, calls, suggested, suggestionCalls, nextSuggestions, tick } =
                createReports();
            reports.open('book-1');
            await settle();
            suggested().forEach((call, index) => call.resolve(response(`Suggestion ${index}`)));
            await settle();

            tick(CACHE_MS - 1);
            reports.input('net result 2011');
            reports.submit();
            await settle();
            expect(suggestionCalls).toHaveLength(1);

            const later = ['Receitas em 2012'];
            let answer: (value: string[]) => void = () => undefined;
            nextSuggestions.push(() => new Promise(resolve => (answer = resolve)));
            tick(1);
            reports.input('despesas 2011');
            reports.submit();
            expect(suggestionCalls).toHaveLength(2);
            // Asking again while they are on their way asks them once.
            reports.input('despesas 2012');
            reports.submit();
            expect(suggestionCalls).toHaveLength(2);
            expect(reports.suggestions).toEqual(SUGGESTIONS);

            answer(later);
            await settle();
            expect(reports.suggestions).toEqual(later);
            expect(calls.at(-1)?.body).toEqual({ prompt: later[0], language: 'pt' });
        });

        it('keeps the suggestions, without a notice, when asking them again fails', async () => {
            const { reports, suggestionCalls, nextSuggestions, tick } = createReports(
                undefined,
                createApi(SUGGESTIONS)
            );
            reports.open('book-1');
            await settle();
            nextSuggestions.push(() =>
                Promise.reject(new AppApiError('Bkper failed', 502, 'upstream_error'))
            );
            tick(CACHE_MS);
            reports.input('despesas 2011');
            reports.submit();
            await settle();

            expect(suggestionCalls).toHaveLength(2);
            expect(reports.suggestions).toEqual(SUGGESTIONS);
            expect(reports.notice).toBeUndefined();
            // A failed request waits another minute before asking again.
            reports.input('despesas 2012');
            reports.submit();
            expect(suggestionCalls).toHaveLength(2);
        });

        it('drops suggestions asked again for a Book left before they answer', async () => {
            const { reports, suggestionCalls, nextSuggestions, tick } = createReports();
            reports.open('book-1');
            await settle();
            let answer: (value: string[]) => void = () => undefined;
            nextSuggestions.push(() => new Promise(resolve => (answer = resolve)));
            tick(CACHE_MS);
            reports.input('despesas 2011');
            reports.submit();
            expect(suggestionCalls).toHaveLength(2);

            reports.open('book-2');
            await settle();
            answer(['Book 1 only']);
            await settle();

            expect(suggestionCalls.map(call => call.bookId)).toEqual([
                'book-1',
                'book-1',
                'book-2',
            ]);
            expect(reports.suggestions).toEqual(SUGGESTIONS);
        });

        it('forgets every report of a Book once another opens, within the minute too', async () => {
            const { reports, calls, prompts } = createReports(undefined, createApi([]));
            reports.open('book-1');
            reports.input('expenses this month');
            reports.submit();
            calls[0].resolve(response('Book 1'));
            await settle();

            reports.open('book-2');
            reports.open('book-1', 'expenses this month');
            expect(prompts()).toEqual(['expenses this month', 'expenses this month']);
            expect(calls[1].bookId).toBe('book-1');
            expect(reports.report).toBeUndefined();
        });
    });

    describe('opened by state', () => {
        const STATE = { text: 'Gastos por mes en 2011', language: 'es', chart: 'stacked' as const };
        const byState = (call: Call) => call.body.chart === 'stacked';

        it('asks for its text, in its language and with its chart, showing the text at once', async () => {
            const { reports, calls, prompts } = createReports();
            reports.open('book-1', '', STATE);

            const call = calls.find(byState);
            expect(call?.body).toEqual({ prompt: STATE.text, language: 'es', chart: 'stacked' });
            expect(prompts()).toEqual([]);
            expect(reports.text).toBe(STATE.text);

            const report = { ...response('Gastos', '2011'), language: 'es' };
            call?.resolve(report);
            await settle();

            expect(reports.report).toBe(report);
            expect(reports.text).toBe(STATE.text);
        });

        it('wins over a request in the URL, and its answer never overwrites typing', async () => {
            const { reports, calls, prompts } = createReports();
            reports.open('book-1', 'net result', STATE);
            expect(prompts()).toEqual([]);

            reports.input('ingresos 2011');
            calls.find(byState)?.resolve(response('Gastos', '2011'));
            await settle();

            expect(reports.text).toBe('ingresos 2011');
        });

        it('shows another report of the same Book, keeping the suggestions and memory', async () => {
            const { reports, calls, suggestionCalls } = createReports();
            reports.open('book-1');
            await settle();
            calls
                .find(call => call.body.prompt === SUGGESTIONS[0])
                ?.resolve({ ...response('Net result', '2011'), language: 'pt' });
            await settle();
            const count = calls.length;

            reports.openState({ text: SUGGESTIONS[0], language: 'pt' });
            await settle();

            expect(calls.length).toBe(count);
            expect(suggestionCalls.length).toBe(1);
            expect(title(reports.report)).toBe('Net result');
            expect(reports.text).toBe(SUGGESTIONS[0]);
        });
    });

    describe('a Book nothing was asked of yet', () => {
        it('is untouched until the person or a state asks for something, even a request cleared', () => {
            const acts: [string, (reports: Reports) => void][] = [
                ['input', reports => reports.input('')],
                ['submit', reports => reports.submit()],
                ['choose', reports => reports.choose(SUGGESTIONS[0])],
                ['saved', reports => reports.runSaved('Net result')],
                ['state', reports => reports.openState(NET)],
            ];
            for (const [, act] of acts) {
                const { reports } = createReports();
                expect(reports.untouched).toBe(false);
                reports.open('book-1');
                expect(reports.untouched).toBe(true);
                reports.fail('error_unexpected');
                reports.chooseChart('pie');
                expect(reports.untouched).toBe(true);
                act(reports);
                expect(reports.untouched).toBe(false);
                reports.open('book-2');
                expect(reports.untouched).toBe(true);
            }
        });

        it('is touched when it opens with a request or a state, and without a Book', () => {
            const { reports } = createReports();
            reports.open('book-1', 'net result');
            expect(reports.untouched).toBe(false);
            reports.open('book-1', '', NET);
            expect(reports.untouched).toBe(false);
            reports.open(undefined);
            expect(reports.untouched).toBe(false);
            reports.open('book-1', '  ');
            expect(reports.untouched).toBe(true);
        });

        it('asks the input to show its request selected', () => {
            const { reports } = createReports();
            const selected: string[] = [];
            reports.addEventListener(SELECT_TEXT, () => selected.push(reports.text));
            reports.open('book-1');
            reports.choose(SUGGESTIONS[0]);
            expect(selected).toEqual([]);

            reports.selectText();

            expect(selected).toEqual(['Net result in 2011']);
        });
    });
});

function title(report: ReportResponse | undefined): string | undefined {
    const root = report?.spec.elements[report.spec.root];
    return root?.type === 'Report' ? root.props.title : undefined;
}

/** A report whose main chart is `main` (`table` for none), asked for as `asked`, if any. */
function withMain(report: ReportResponse, main: ChartKind, asked?: StateChart) {
    return {
        ...report,
        chart: {
            kind: main === 'table' ? 'none' : main,
            fallback: false,
            ...(asked ? { asked } : {}),
        },
    } satisfies ReportResponse;
}
