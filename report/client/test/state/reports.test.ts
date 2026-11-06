import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AppApiError,
    type ReportRequest,
    type ReportResponse,
    type Suggestion,
} from '../../src/api/app-api';
import { DEBOUNCE_MS, Reports, type ReportApi } from '../../src/state/reports';
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
        intent: { root: 'net-result', period: '2011', monthly: false },
        language: 'en',
        query: 'q',
        dataAt: '2026-11-05T00:00:00Z',
        chart: { kind: 'none', fallback: false },
        url: 'https://report.bkper.app/',
    };
}

const SUGGESTIONS: Suggestion[] = [
    { text: 'Net result in 2011', intent: { root: 'net-result', period: '2011', monthly: false } },
    { text: 'Despesas by month in 2011', intent: { root: 'g-1', period: '2011', monthly: true } },
    { text: 'Investidores today', intent: { root: 'g-2', period: 'this_month', monthly: false } },
];

interface Call {
    bookId: string;
    body: ReportRequest;
    signal?: AbortSignal;
    resolve(value: ReportResponse): void;
    reject(reason: unknown): void;
}

/** An API whose report requests answer only when a test says so; suggestions answer at once. */
function createApi(suggestions: Suggestion[] = SUGGESTIONS) {
    const calls: Call[] = [];
    const suggestionCalls: { bookId: string; language?: string }[] = [];
    const api: ReportApi = {
        suggestions: async (bookId, options) => {
            suggestionCalls.push({ bookId, language: options.language });
            return suggestions;
        },
        report: (bookId, body, options) =>
            new Promise((resolve, reject) => {
                calls.push({ bookId, body, signal: options.signal, resolve, reject });
            }),
    };
    const prompts = () => calls.flatMap(call => (call.body.prompt ? [call.body.prompt] : []));
    const intentCalls = () => calls.filter(call => call.body.intent);
    return { api, calls, prompts, intentCalls, suggestionCalls };
}

function createReports(href = 'https://report.bkper.app/?book=book-1', api = createApi()) {
    const page = createPage(href);
    const route = new Route(page, false);
    const reports = new Reports(api.api, route, { language: 'pt', logger: { error: () => {} } });
    return { reports, route, page, ...api };
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

    it('prefetches the suggested reports, so choosing one shows it from memory', async () => {
        const { reports, calls, intentCalls, page } = createReports();
        reports.open('book-1');
        await settle();

        expect(intentCalls().map(call => call.body)).toEqual(
            SUGGESTIONS.map(suggestion => ({ intent: suggestion.intent, language: 'pt' }))
        );
        intentCalls().forEach((call, index) => call.resolve(response(`Suggestion ${index}`)));
        await settle();

        reports.choose(SUGGESTIONS[1]);

        expect(title(reports.report)).toBe('Suggestion 1');
        expect(reports.pending).toBe(false);
        expect(reports.text).toBe('Despesas by month in 2011');
        expect(page.location.href).toBe(
            'https://report.bkper.app/?book=book-1&q=Despesas+by+month+in+2011'
        );
        expect(calls).toHaveLength(3);
    });

    it('shows a suggestion chosen before its prefetch answers, without asking twice', async () => {
        const { reports, calls, intentCalls } = createReports();
        reports.open('book-1');
        await settle();

        reports.choose(SUGGESTIONS[0]);
        expect(reports.pending).toBe(true);
        intentCalls()[0].resolve(response('Net'));
        await settle();

        expect(title(reports.report)).toBe('Net');
        expect(calls).toHaveLength(3);
    });

    it('answers a request asked before from memory, however it is spaced or cased', async () => {
        const { reports, calls, prompts } = createReports();
        reports.open('book-1');
        await settle();
        reports.input('net result 2011');
        reports.submit();
        calls.at(-1)?.resolve(response('Net'));
        await settle();
        reports.input('other report');
        reports.submit();

        reports.input('  Net   RESULT 2011 ');
        reports.submit();

        expect(title(reports.report)).toBe('Net');
        expect(reports.pending).toBe(false);
        expect(prompts()).toEqual(['net result 2011', 'other report']);
    });

    it('remembers reports of one intent with different charts apart', async () => {
        const { reports, calls, intentCalls } = createReports();
        reports.open('book-1');
        await settle();
        reports.input('net result 2011 as a pie');
        reports.submit();
        calls.at(-1)?.resolve({
            ...response('Pie'),
            intent: { ...SUGGESTIONS[0].intent, chart: 'pie' },
            language: 'pt',
        });
        await settle();

        reports.choose(SUGGESTIONS[0]);
        intentCalls()[0].resolve({ ...response('Net'), language: 'pt' });
        await settle();

        expect(title(reports.report)).toBe('Net');
    });

    it('answers a typed suggestion text from memory', async () => {
        const { reports, intentCalls, prompts } = createReports();
        reports.open('book-1');
        await settle();
        intentCalls().forEach((call, index) => call.resolve(response(`Suggestion ${index}`)));
        await settle();

        reports.input('net result in 2011');
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

    describe('opened by state', () => {
        const STATE = {
            intent: { root: 'g-1', period: '2011', monthly: true, chart: 'stacked' as const },
            language: 'es',
        };
        const byState = (call: Call) => call.body.intent?.chart === 'stacked';

        it('asks for the report by intent, in its language, and shows its label', async () => {
            const { reports, calls, prompts } = createReports();
            reports.open('book-1', '', STATE);

            const call = calls.find(byState);
            expect(call?.body).toEqual({ intent: STATE.intent, language: 'es' });
            expect(prompts()).toEqual([]);
            expect(reports.text).toBe('');

            const report = {
                ...response('Gastos', '\u20682011\u2069'),
                intent: STATE.intent,
                language: 'es',
            };
            call?.resolve(report);
            await settle();

            expect(reports.report).toBe(report);
            expect(reports.text).toBe('Gastos 2011');
        });

        it('wins over a request in the URL, and its label never overwrites typing', async () => {
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
                .find(call => call.body.intent?.root === 'net-result')
                ?.resolve(response('Net result', '2011'));
            await settle();
            const count = calls.length;

            reports.openState({ intent: SUGGESTIONS[0].intent, language: 'pt' });
            await settle();

            expect(calls.length).toBe(count);
            expect(suggestionCalls.length).toBe(1);
            expect(title(reports.report)).toBe('Net result');
            expect(reports.text).toBe('Net result 2011');
        });
    });
});

function title(report: ReportResponse | undefined): string | undefined {
    const root = report?.spec.elements[report.spec.root];
    return root?.type === 'Report' ? root.props.title : undefined;
}

/** A report whose main chart is `main`, as its trace says. */
function withMain(report: ReportResponse, main: ReportResponse['trace']['chart']['main']) {
    return {
        ...report,
        trace: { facts: FACTS, chart: { fitting: [main, 'pie', 'table'], main, rule: 'rules' } },
    } satisfies ReportResponse;
}

const FACTS: ReportResponse['trace']['facts'] = {
    rows: 3,
    negative: 0,
    mixed: false,
    months: 12,
    previous: true,
    net: false,
    permanent: false,
};
