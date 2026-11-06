import { BalancesReport, Book, BkperError, User, type Config } from 'bkper-js';
import { addLocale } from 'report-shared/strings';
import { validateReportSpec, type ReportElement, type ReportSpec } from 'report-shared/catalog';
import type { ReportFileData } from 'report-shared/report-file';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../../src/app-context';
import { createDecisionClient } from '../../src/services/decision-client';
import { createApp } from '../../src/index';
import { balancesPayloads, bookPayload } from '../fixtures/snapshot-book';
import { createTestEnv } from '../test-env';

const BOOK = 'book-1';
const REPORT_URL = `http://localhost:8809/api/v1/books/${BOOK}/report`;
const SUGGESTIONS_URL = `http://localhost:8809/api/v1/books/${BOOK}/suggestions`;

/** The fixture Book's today, 2026-11-05, at noon in São Paulo. */
const NOW = new Date('2026-11-05T15:00:00Z');

/** Reads the fixture Book; the Report app never writes to a Book, so nothing else is faked. */
class FakeBkper {
    bookLoads = 0;

    constructor(
        private readonly options: { permission?: bkper.Permission; failure?: BkperError } = {}
    ) {}

    async getUser(): Promise<User> {
        return new User({ id: 'user-1' });
    }

    async getBook(): Promise<Book> {
        this.bookLoads++;
        if (this.options.failure) {
            throw this.options.failure;
        }
        const payload = structuredClone(bookPayload);
        payload.permission = this.options.permission ?? 'VIEWER';
        const book = new Book(payload);
        book.getBalancesReport = async (query: string) =>
            new BalancesReport(book, balancesPayloads[query]);
        return book;
    }

    getConfig(): Config {
        return {};
    }
}

interface JevAnswers {
    root: string;
    period?: string;
    language?: string;
}

function jevResponse(answers: JevAnswers): Response {
    const choice = (value: string) => ({
        type: 'choice',
        choice: value,
        confidence: 0.99,
        probabilities: { [value]: 0.99 },
    });
    return Response.json({
        model: 'jev',
        answers: {
            root: choice(answers.root),
            period: choice(answers.period ?? 'unspecified'),
            monthly: { type: 'noul', noul: 0.01 },
            view: choice('unspecified'),
            language: choice(answers.language ?? 'en'),
        },
        usage: { input_tokens: 1000, output_tokens: 10 },
    });
}

function aiError(status: number, code: string): () => Response {
    return () =>
        Response.json(
            { error: { message: `Bkper AI ${code}`, type: 'error', param: null, code } },
            { status }
        );
}

interface Harness {
    app: ReturnType<typeof createApp>;
    env: ReturnType<typeof createTestEnv>;
    bkper: FakeBkper;
    jevCalls: number;
    queries: string[];
}

function harness(
    options: {
        bkper?: FakeBkper;
        jev?: JevAnswers | (() => Response);
        balances?: bkper.Balances;
    } = {}
): Harness {
    const jev = options.jev ?? { root: 'Expenses', period: '2026-10', language: 'en' };
    const state: Harness = {
        env: createTestEnv(),
        bkper: options.bkper ?? new FakeBkper(),
        jevCalls: 0,
        queries: [],
        app: createApp(c => {
            return new AppContext(state.bkper, c.env, {
                decisions: createDecisionClient({
                    fetch: async () => {
                        state.jevCalls++;
                        return typeof jev === 'function' ? jev() : jevResponse(jev);
                    },
                }),
                readBalances: async (book, query) => {
                    state.queries.push(query);
                    return new BalancesReport(new Book({ id: book.id }), {
                        periodicity: 'DAILY',
                        groupBalances: options.balances?.groupBalances ?? [],
                    });
                },
            });
        }),
    };
    return state;
}

function elementOf<T extends ReportElement['type']>(spec: ReportSpec, type: T) {
    const element = Object.values(spec.elements).find(
        (candidate): candidate is Extract<ReportElement, { type: T }> => candidate.type === type
    );
    if (!element) {
        throw new Error(`No ${type} in the spec`);
    }
    return element;
}

async function post(test: Harness, body: unknown, init: RequestInit & { url?: string } = {}) {
    const { url, ...rest } = init;
    return test.app.request(
        url ?? REPORT_URL,
        {
            method: 'POST',
            ...rest,
            headers: { 'Content-Type': 'application/json', ...rest.headers },
            body: JSON.stringify(body),
        },
        test.env
    );
}

function timings(response: Response): string[] {
    return (response.headers.get('Server-Timing') ?? '')
        .split(', ')
        .map(metric => metric.split(';')[0]);
}

describe('GET /api/v1/books/{bookId}/suggestions', () => {
    it('suggests three reports with their intents and warms the snapshot', async () => {
        const test = harness();
        const response = await test.app.request(SUGGESTIONS_URL, {}, test.env);

        expect(response.status).toBe(200);
        const body = (await response.json()) as { suggestions: { text: string }[] };
        expect(body.suggestions).toHaveLength(3);
        expect(body.suggestions[0]).toEqual({
            text: 'Net result this year',
            intent: { root: 'net-result', period: 'this_year', monthly: false },
        });
        expect(timings(response)).toEqual(['user', 'kv', 'balances', 'compute', 'total']);

        const warm = await test.app.request(SUGGESTIONS_URL, {}, test.env);
        expect(warm.status).toBe(200);
        expect(test.bkper.bookLoads).toBe(1);
        expect(timings(warm)).toEqual(['user', 'kv', 'compute', 'total']);
    });

    it('writes suggestions in the requested language, else the accepted one', async () => {
        addLocale('eo', { suggestion_net_result_this_year: 'Neta rezulto ĉi-jare' });
        addLocale('ia', { suggestion_net_result_this_year: 'Resultato net iste anno' });
        const test = harness();
        const first = async (url: string, headers: Record<string, string> = {}) => {
            const response = await test.app.request(url, { headers }, test.env);
            const body = (await response.json()) as { suggestions: { text: string }[] };
            return body.suggestions[0].text;
        };

        expect(await first(`${SUGGESTIONS_URL}?language=eo`, { 'Accept-Language': 'ia' })).toBe(
            'Neta rezulto ĉi-jare'
        );
        expect(await first(SUGGESTIONS_URL, { 'Accept-Language': 'tlh, eo;q=0.5' })).toBe(
            'Neta rezulto ĉi-jare'
        );
    });

    it('rejects a language that is not a Bkper language', async () => {
        const test = harness();
        const response = await test.app.request(`${SUGGESTIONS_URL}?language=tlh`, {}, test.env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    });
});

describe('POST /api/v1/books/{bookId}/report', () => {
    it('builds a report by intent without Bkper AI', async () => {
        const test = harness();
        const intent = { root: 'g-expenses', period: '2026-10', monthly: false };
        const response = await post(test, { intent }, { headers: { 'Accept-Language': 'pt-BR' } });

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(test.jevCalls).toBe(0);
        expect(body).toMatchObject({
            intent,
            language: 'pt',
            query: "group:'Expenses' after:2026-10-01 before:2026-11-01",
            url: `https://report.bkper.app/?book=${BOOK}&q=Expenses+outubro+de+2026`,
        });
        expect(typeof body.dataAt).toBe('string');
        expect(validateReportSpec(body.spec).valid).toBe(true);
        expect(timings(response)).toEqual(['user', 'kv', 'balances', 'compute', 'render', 'total']);
    });

    it('builds a report by prompt with one Bkper AI decision', async () => {
        const test = harness({ jev: { root: 'Revenue', period: '2026-10', language: 'es' } });
        const response = await post(test, { prompt: 'ingresos de octubre' });

        expect(response.status).toBe(200);
        expect(test.jevCalls).toBe(1);
        expect(await response.json()).toMatchObject({
            intent: { root: 'g-revenue', period: '2026-10', monthly: false },
            language: 'es',
            query: "group:'Revenue' after:2026-10-01 before:2026-11-01",
            url: `https://report.bkper.app/?book=${BOOK}&q=ingresos+de+octubre`,
        });
        expect(timings(response)).toContain('jev');
    });

    it('prefers the requested language and links to the environment called', async () => {
        const test = harness({ jev: { root: 'Revenue', language: 'es' } });
        const response = await post(
            test,
            { prompt: 'ingresos', language: 'fr-CA', format: 'spec' },
            { url: `https://report-preview.bkper.app/api/v1/books/${BOOK}/report` }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            language: 'fr',
            url: `https://report-preview.bkper.app/?book=${BOOK}&q=ingresos`,
        });
    });

    it('returns a self-contained HTML file of the report that links to the Report app', async () => {
        const test = harness();
        const intent = { root: 'g-expenses', period: '2026-10', monthly: false };
        const response = await post(test, { intent, language: 'en', format: 'html' });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toMatch(/^text\/html; charset=utf-8$/i);
        const html = await response.text();
        expect(html).toMatch(/^<!doctype html>/i);
        expect(html).toContain('<title>Expenses · October 2026</title>');
        const data = JSON.parse(
            /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(html)?.[1] ??
                ''
        ) as ReportFileData;
        expect(validateReportSpec(data.spec).valid).toBe(true);
        expect(elementOf(data.spec, 'Source').on).toBeUndefined();
        expect(data.link).toEqual({
            url: `https://report.bkper.app/?book=${BOOK}&q=Expenses+October+2026`,
            label: 'Open in Report',
        });
        expect(timings(response)).toEqual(['user', 'kv', 'balances', 'compute', 'render', 'total']);
    });

    it('reads a hashtag report with one live balances query', async () => {
        const test = harness({ jev: { root: 'Expenses', period: 'last_month' } });
        const response = await post(test, { prompt: 'expenses last month #trip' });

        expect(response.status).toBe(200);
        expect(test.queries).toEqual([expect.stringContaining('#trip before:2026-11-06 by:d')]);
        expect(await response.json()).toMatchObject({
            intent: { hashtags: ['trip'] },
            query: "group:'Expenses' #trip after:2026-10-01 before:2026-11-01",
        });
    });

    it.each([
        ['neither prompt nor intent', {}],
        [
            'both prompt and intent',
            { prompt: 'x', intent: { root: 'r', period: 'all', monthly: false } },
        ],
        ['a blank prompt', { prompt: '   ' }],
        ['an invalid period', { intent: { root: 'g-expenses', period: 'soon', monthly: false } }],
        ['a language that is not BCP 47', { prompt: 'expenses', language: 'not a tag' }],
        ['a format not served', { prompt: 'expenses', format: 'pdf' }],
    ])('rejects %s', async (_case, body) => {
        const test = harness();
        const response = await post(test, body);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            success: false,
            error: { code: 'invalid_request' },
        });
        expect(test.jevCalls).toBe(0);
    });

    it.each([
        [{}, 'Send exactly one of `prompt` or `intent`.'],
        [
            { prompt: 'x', intent: { root: 'r', period: 'all', monthly: false } },
            'Send exactly one of `prompt` or `intent`.',
        ],
        [{ prompt: 'expenses', format: 'pdf' }, 'format: '],
        [{ intent: { root: 'g-expenses', period: 'soon', monthly: false } }, 'intent.period: '],
    ])('tells what is invalid in %j', async (body, message) => {
        const response = await post(harness(), body);

        expect(response.status).toBe(400);
        const { error } = (await response.json()) as { error: { message: string } };
        expect(error.message).toContain(message);
    });

    it('answers a request that is not a report with suggestions, never echoing it', async () => {
        const test = harness({ jev: { root: 'none' } });
        const response = await post(test, { prompt: 'what is the weather in Lisbon' });

        expect(response.status).toBe(422);
        const text = await response.text();
        expect(text).not.toContain('Lisbon');
        const body = JSON.parse(text) as { error: { code: string }; suggestions: unknown[] };
        expect(body.error.code).toBe('not_a_report');
        expect(body.suggestions).toHaveLength(3);
    });

    it.each([
        ['future_period', { root: 'g-expenses', period: '2099', monthly: false }],
        ['unknown_root', { root: 'g-missing', period: 'this_year', monthly: false }],
    ])('answers %s for an intent the Book cannot have', async (code, intent) => {
        const response = await post(harness(), { intent });

        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ error: { code } });
    });

    it.each([
        [429, 'usage_limit_exceeded', 429, 'ai_allowance_exhausted'],
        [400, 'context_length_exceeded', 502, 'upstream_error'],
    ])('maps Bkper AI %s %s to %s %s', async (status, aiCode, expectedStatus, code) => {
        const test = harness({ jev: aiError(status, aiCode) });
        const response = await post(test, { prompt: 'expenses this year' });

        expect(response.status).toBe(expectedStatus);
        expect(await response.json()).toMatchObject({ success: false, error: { code } });
    });

    it.each([
        [new BkperError(404, 'Book NOT found! ID: book-1'), 404, 'book_not_found'],
        [new BkperError(403, 'Forbidden'), 403, 'forbidden'],
        // Bkper answers 401 to a signed-in user who is not a collaborator on the Book.
        [
            new BkperError(401, 'The user [a@b.c] is not a collaborator on the book [X]'),
            403,
            'forbidden',
        ],
        [new BkperError(503, 'Unavailable'), 502, 'upstream_error'],
    ])('maps Bkper failures loading the Book: %s', async (failure, status, code) => {
        const test = harness({ bkper: new FakeBkper({ failure }) });
        const response = await post(test, { prompt: 'expenses' });

        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ error: { code } });
        expect(test.jevCalls).toBe(0);
        expect(timings(response)).toEqual(['user', 'kv', 'balances', 'total']);
    });

    it('requires a permission that can read balances', async () => {
        const test = harness({ bkper: new FakeBkper({ permission: 'RECORDER' }) });
        const response = await post(test, { prompt: 'expenses' });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
        expect(test.jevCalls).toBe(0);
    });
});
