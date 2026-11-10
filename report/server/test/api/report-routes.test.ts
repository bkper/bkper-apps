import { periodRequestOf, type PeriodParts } from 'report-shared/report-intent';
import { decodeUrlState } from 'report-shared/url-state';
import { BalancesReport, Book, BkperError, User, type Config } from 'bkper-js';
import { addLocale } from 'report-shared/strings';
import { validateReportSpec, type ReportElement, type ReportSpec } from 'report-shared/catalog';
import type { ReportFileData } from 'report-shared/report-file';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../src/app-context';
import { createDecisionClient } from '../../src/services/decision-client';
import { createApp } from '../../src/index';
import type { FakeLedger } from '../fixtures/ledger';
import { fixtureLedger, simpleRootsLedger } from '../fixtures/snapshot-book';
import { createTestEnv } from '../test-env';
import { periodChoices } from '../fixtures/period-answers';
import { asksRanking, rankingResponse } from '../fixtures/suggestion-answers';

/** The parts of a period id, as intents now hold them. */
function p(id: string): PeriodParts {
    const request = periodRequestOf(id);
    if (!request) throw new Error(`Not a period id: ${id}`);
    return request.period;
}

const BOOK = 'book-1';
const REPORT_URL = `http://localhost:8809/api/v1/books/${BOOK}/report`;
const SUGGESTIONS_URL = `http://localhost:8809/api/v1/books/${BOOK}/suggestions`;
const NAMES_URL = `http://localhost:8809/api/v1/books/${BOOK}/names`;

/** The fixture Book's today, 2026-11-05, at noon in São Paulo. */
const NOW = new Date('2026-11-05T15:00:00Z');

// The routes read the clock: the fixture's queries are those of its today.
beforeAll(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }));
afterAll(() => vi.useRealTimers());

/** Reads the fixture Book; the Report app never writes to a Book, so nothing else is faked. */
class FakeBkper {
    bookLoads = 0;
    readonly ledger: FakeLedger;

    constructor(
        private readonly options: {
            permission?: bkper.Permission;
            failure?: BkperError;
            ledger?: FakeLedger;
        } = {}
    ) {
        this.ledger = options.ledger ?? fixtureLedger();
    }

    async getUser(): Promise<User> {
        return new User({ id: 'user-1' });
    }

    async getBook(): Promise<Book> {
        this.bookLoads++;
        if (this.options.failure) {
            throw this.options.failure;
        }
        const payload = structuredClone(this.ledger.book);
        payload.permission = this.options.permission ?? 'VIEWER';
        const book = new Book(payload);
        book.getBalancesReport = async (query: string) =>
            new BalancesReport(book, this.ledger.balances(query));
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
            ...Object.fromEntries(
                Object.entries(periodChoices(answers.period)).map(([id, label]) => [
                    id,
                    choice(label),
                ])
            ),
            over_time: { type: 'noul', noul: 0.01 },
            composition: { type: 'noul', noul: 0.01 },
            versus_earlier: { type: 'noul', noul: 0.01 },
            year_earlier: { type: 'noul', noul: 0.01 },
            bridge: { type: 'noul', noul: 0.01 },
            chart_named: choice('none'),
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
    /** Requests that ranked the suggestions. */
    rankings: number;
    queries: string[];
}

function harness(
    options: {
        bkper?: FakeBkper;
        jev?: JevAnswers | (() => Response);
    } = {}
): Harness {
    const jev = options.jev ?? { root: 'Expenses', period: '2026-10', language: 'en' };
    const state: Harness = {
        env: createTestEnv(),
        bkper: options.bkper ?? new FakeBkper(),
        jevCalls: 0,
        rankings: 0,
        queries: [],
        app: createApp(c => {
            return new AppContext(state.bkper, c.env, {
                decisions: createDecisionClient({
                    fetch: async (_url, init) => {
                        if (asksRanking(init)) {
                            state.rankings++;
                            return rankingResponse();
                        }
                        state.jevCalls++;
                        return typeof jev === 'function' ? jev() : jevResponse(jev);
                    },
                }),
                readBalances: async (book, query) => {
                    state.queries.push(query);
                    return new BalancesReport(
                        new Book({ id: book.id }),
                        state.bkper.ledger.balances(query)
                    );
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

describe('GET /api/v1/books/{bookId}/names', () => {
    it('lists the names of the Book’s map, read once a minute and shared with the reports', async () => {
        const test = harness();
        const response = await test.app.request(NAMES_URL, {}, test.env);

        expect(response.status).toBe(200);
        const { names } = (await response.json()) as {
            names: { id: string; name: string; kind: string; root: string }[];
        };
        expect(names).toHaveLength(15);
        expect(names[0]).toEqual({
            id: 'g-assets',
            name: 'Assets',
            kind: 'group',
            root: 'g-assets',
        });
        expect(names).toContainEqual({
            id: 'a-card',
            name: 'Credit Card',
            kind: 'account',
            root: 'g-card',
        });
        expect(names.at(-1)).toEqual({
            id: 'a-owner',
            name: 'Owner',
            kind: 'account',
            root: 'a-owner',
        });
        // The map is the Book's structure: loaded once, with no balances query.
        expect(timings(response)).toEqual(['user', 'kv', 'book', 'compute', 'total']);
        expect(test.queries).toEqual([]);

        // The same cached map serves the suggestions: the Book is read once.
        const warm = await test.app.request(SUGGESTIONS_URL, {}, test.env);
        expect(warm.status).toBe(200);
        expect(test.bkper.bookLoads).toBe(1);
    });

    it('lists names only to those who may read the Book’s reports', async () => {
        const test = harness({ bkper: new FakeBkper({ permission: 'RECORDER' }) });
        const response = await test.app.request(NAMES_URL, {}, test.env);

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
    });
});

describe('GET /api/v1/books/{bookId}/suggestions', () => {
    it('suggests three reports as requests and warms the snapshot', async () => {
        const test = harness();
        const response = await test.app.request(SUGGESTIONS_URL, {}, test.env);

        expect(response.status).toBe(200);
        // The report Jev ranks first: the Book's own net income.
        expect(await response.json()).toEqual({
            suggestions: ['Net income this year', 'Assets today', 'Expenses by month this year'],
        });
        expect(test.rankings).toBe(1);
        // Jev ranks the map once. This year has movements: the suggestions read only their
        // reports' own queries (a position today never moves, so it reads none here), in parallel.
        expect(timings(response)).toEqual([
            'user',
            'kv',
            'book',
            'jev',
            'compute',
            'balances',
            'total',
        ]);
        expect([...test.queries].sort()).toEqual([
            "group:'Expenses' after:$y before:$m+1 by:m",
            "group:'Expenses' after:$y-1 before:$m-11 by:m",
            "group:'Net income' after:$y before:$m+1 by:m",
            "group:'Net income' after:$y-1 before:$m-11 by:m",
        ]);

        const warm = await test.app.request(SUGGESTIONS_URL, {}, test.env);
        expect(warm.status).toBe(200);
        expect(test.bkper.bookLoads).toBe(1);
        // The ranking of the same map is remembered: Jev is not asked again.
        expect(test.rankings).toBe(1);
        expect(timings(warm)).toEqual(['user', 'kv', 'compute', 'total']);
        expect(test.queries).toHaveLength(4);
    });

    it('suggests the last year with movements of a Book with only old data, and its reports are read', async () => {
        // Years after the fixture's last movements, in November 2026.
        vi.setSystemTime(new Date('2028-03-10T15:00:00Z'));
        try {
            const test = harness();
            test.bkper.ledger.today = '2028-03-10';
            const response = await test.app.request(SUGGESTIONS_URL, {}, test.env);
            const { suggestions } = (await response.json()) as { suggestions: string[] };
            expect(suggestions).toEqual([
                'Net income in 2026',
                'Assets today',
                'Expenses by month in 2026',
            ]);
            const read = test.queries.length;

            // Their reports, asked for by their texts as the client prefetches them, show the
            // Book's data, from the balances the suggestions read, with no AI.
            const expenses = await post(test, { prompt: suggestions[2], language: 'en' });
            const body = (await expenses.json()) as { spec: ReportSpec; query: string };
            expect(elementOf(body.spec, 'Answer').props.amount).not.toBe('0');
            expect(body.query).toBe("group:'Expenses' on:2026 by:m");
            expect(test.queries).toHaveLength(read);
            expect(test.jevCalls).toBe(0);
        } finally {
            vi.setSystemTime(NOW);
        }
    });

    it('writes suggestions in the requested language, else the accepted one', async () => {
        addLocale('eo', { suggestion_breakdown_this_year: '{root} ĉi-jare' });
        addLocale('ia', { suggestion_breakdown_this_year: '{root} iste anno' });
        const test = harness();
        const first = async (url: string, headers: Record<string, string> = {}) => {
            const response = await test.app.request(url, { headers }, test.env);
            const body = (await response.json()) as { suggestions: string[] };
            return body.suggestions[0];
        };

        expect(await first(`${SUGGESTIONS_URL}?language=eo`, { 'Accept-Language': 'ia' })).toBe(
            'Net income ĉi-jare'
        );
        expect(await first(SUGGESTIONS_URL, { 'Accept-Language': 'tlh, eo;q=0.5' })).toBe(
            'Net income ĉi-jare'
        );
    });

    it('tells no problem for a Book that has reports', async () => {
        const test = harness();
        const body = (await (await test.app.request(SUGGESTIONS_URL, {}, test.env)).json()) as {
            problem?: unknown;
        };
        expect(body.problem).toBeUndefined();
    });

    it('tells, with no suggestions, when the Book has nothing to report', async () => {
        const empty = fixtureLedger();
        for (const account of empty.book.accounts ?? []) {
            account.hasTransactionPosted = false;
        }
        const test = harness({ bkper: new FakeBkper({ ledger: empty, permission: 'OWNER' }) });
        const response = await test.app.request(SUGGESTIONS_URL, {}, test.env);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            suggestions: [],
            problem: { code: 'empty_book', bookName: 'Test Ledger', canOrganize: true },
        });
        expect(test.queries).toEqual([]);

        const flat = fixtureLedger();
        flat.book.groups = [];
        for (const account of flat.book.accounts ?? []) {
            account.groups = [];
        }
        const viewer = harness({ bkper: new FakeBkper({ ledger: flat }) });
        const unorganized = await viewer.app.request(SUGGESTIONS_URL, {}, viewer.env);
        expect(await unorganized.json()).toEqual({
            suggestions: [],
            problem: {
                code: 'nothing_to_report',
                bookName: 'Test Ledger',
                canOrganize: false,
                ungrouped: 9,
                total: 9,
            },
        });
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
        const intent = { root: 'g-expenses', period: p('2026-10'), monthly: false };
        const response = await post(test, { intent }, { headers: { 'Accept-Language': 'pt-BR' } });

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(test.jevCalls).toBe(0);
        expect(body).toMatchObject({
            intent,
            language: 'pt',
            query: "group:'Expenses' on:2026-10 by:m",
            text: 'Expenses outubro de 2026',
            url: `https://report.bkper.app/?book=${BOOK}&q=Expenses+outubro+de+2026`,
        });
        expect(typeof body.dataAt).toBe('string');
        expect(validateReportSpec(body.spec).valid).toBe(true);
        expect(timings(response)).toEqual([
            'user',
            'kv',
            'book',
            'balances',
            'compute',
            'render',
            'total',
        ]);
        expect(test.queries).toEqual([
            "group:'Expenses' on:2026-10 by:m",
            "group:'Expenses' on:2026-09 by:m",
        ]);
    });

    it('takes the period id of an older intent, and answers with its parts', async () => {
        const test = harness();
        const response = await post(test, {
            intent: {
                root: 'g-expenses',
                period: '2026-10',
                compareWith: 'year_earlier',
                monthly: false,
            },
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            intent: {
                root: 'g-expenses',
                period: { span: 'month', year: 2026, month: 10 },
                compareWith: 'year_earlier',
                monthly: false,
            },
            query: "group:'Expenses' on:2026-10 by:m",
        });
        expect(test.queries).toEqual([
            "group:'Expenses' on:2026-10 by:m",
            "group:'Expenses' on:2025-10 by:m",
        ]);
    });

    it('compares the period with the one the intent names, and links to it as asked', async () => {
        const test = harness();
        const intent = {
            root: 'g-expenses',
            period: { span: 'year', year: 'previous' },
            compared: { year: 2023 },
            monthly: false,
        };
        const response = await post(test, { intent });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { trace: Record<string, unknown> };
        expect(body).toMatchObject({
            intent,
            query: "group:'Expenses' on:$y-1 by:m",
            url: `https://report.bkper.app/?book=${BOOK}&q=Expenses+last+year+vs.+2023`,
        });
        expect(body.trace.comparisonError).toBeUndefined();
        expect(test.queries).toEqual([
            "group:'Expenses' on:$y-1 by:m",
            "group:'Expenses' on:2023 by:m",
        ]);
    });

    it('says why it compares with the previous period when the one named cannot be', async () => {
        const test = harness();
        const response = await post(test, {
            intent: {
                root: 'g-expenses',
                period: { span: 'year', year: 2025 },
                compared: { month: 3 },
                monthly: false,
            },
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            spec: { root: string; elements: Record<string, { props: { notice?: string } }> };
            trace: { comparisonError?: string };
        };
        expect(body.trace.comparisonError).toBe('comparison_kind_mismatch');
        expect(body.spec.elements[body.spec.root].props.notice).toBeTruthy();
        expect(test.queries).toEqual([
            "group:'Expenses' on:2025 by:m",
            "group:'Expenses' on:2024 by:m",
        ]);
    });

    it('reuses the balances of the same queries within a minute, for the same user', async () => {
        const test = harness();
        const october = { root: 'g-expenses', period: p('2026-10'), monthly: false };
        const first = await post(test, { intent: october });
        // The same report, drawn another way: the same queries.
        const again = await post(test, { intent: { ...october, chart: 'table' } });
        // September is October's previous period: only its own previous one is read.
        await post(test, { intent: { ...october, period: p('2026-09') } });

        expect([first.status, again.status]).toEqual([200, 200]);
        expect(test.queries).toEqual([
            "group:'Expenses' on:2026-10 by:m",
            "group:'Expenses' on:2026-09 by:m",
            "group:'Expenses' on:2026-08 by:m",
        ]);
        expect(((await again.json()) as { dataAt: string }).dataAt).toBe(
            ((await first.json()) as { dataAt: string }).dataAt
        );
    });

    it('draws the chart an intent prefers, and tells when it does not fit', async () => {
        const test = harness();
        const ask = async (chart: string) => {
            const intent = { root: 'g-expenses', period: p('2026-10'), monthly: false, chart };
            const response = await post(test, { intent });
            expect(response.status).toBe(200);
            const body = (await response.json()) as { intent: unknown; chart: unknown };
            expect(body.intent).toEqual(intent);
            return body.chart;
        };

        expect(await ask('pie')).toEqual({ kind: 'pie', fallback: false });
        expect(await ask('table')).toEqual({ kind: 'none', fallback: false });
        expect(await ask('stacked')).toEqual({ kind: 'donut', fallback: true });
        const traced = await post(test, {
            intent: { root: 'g-expenses', period: p('2026-10'), monthly: false, chart: 'area' },
        });
        expect(((await traced.json()) as { trace: unknown }).trace).toEqual({
            facts: {
                rows: 2,
                negative: 0,
                mixed: false,
                months: 1,
                previous: true,
                net: false,
                permanent: false,
            },
            chart: {
                fitting: ['bar', 'ranked-bar', 'donut', 'pie', 'compare', 'table'],
                main: 'donut',
                rule: 'closest',
                unfit: { kind: 'area', reason: { code: 'few_months' } },
            },
        });
        const invalid = await post(test, {
            intent: { root: 'g-expenses', period: p('2026-10'), monthly: false, chart: 'bars' },
        });
        expect(invalid.status).toBe(400);
    });

    it('still takes a waterfall, and offers the closest chart with why it draws none', async () => {
        const test = harness();
        const intent = {
            root: 'net-result',
            period: p('2026-10'),
            monthly: false,
            chart: 'waterfall',
        };
        const response = await post(test, { intent });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            intent: unknown;
            chart: unknown;
            trace: { chart: { unfit?: unknown; fitting: string[] } };
            spec: ReportSpec;
        };
        expect(body.intent).toEqual(intent);
        expect(body.chart).toEqual({ kind: 'compare', fallback: true });
        expect(body.trace.chart.unfit).toEqual({
            kind: 'waterfall',
            reason: { code: 'no_bridge' },
        });
        expect(body.trace.chart.fitting).not.toContain('waterfall');
        expect(elementOf(body.spec, 'Visualizations').props.unfit).toMatchObject({
            kind: 'waterfall',
        });
    });

    it('labels a net result Report calculates, in the spec and in the file', async () => {
        const test = harness({ bkper: new FakeBkper({ ledger: simpleRootsLedger() }) });
        const intent = { root: 'net-result', period: p('2026-10'), monthly: false };
        const response = await post(test, { intent });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { spec: ReportSpec };
        expect(elementOf(body.spec, 'Source').props.calculated?.label).toBe('Calculated by Report');
        const file = await post(test, { intent, format: 'html' });
        expect(file.status).toBe(200);
        expect(await file.text()).toContain('Calculated by Report');
    });

    it('answers a net result the Book does not have with a reason to act on', async () => {
        const ledger = simpleRootsLedger();
        ledger.addGroup(
            {
                id: 'g-travel',
                name: 'Travel',
                type: 'OUTGOING',
                credit: false,
                permanent: false,
            },
            ['a-food']
        );
        const test = harness({ bkper: new FakeBkper({ ledger }) });
        const response = await post(test, {
            intent: { root: 'net-result', period: p('2026-10'), monthly: false },
        });
        expect(response.status).toBe(422);
        const body = (await response.json()) as {
            error: { code: string; message: string };
            problem: unknown;
        };
        expect(body.error.code).toBe('no_net_result');
        expect(body.error.message).toContain('groups only');
        expect(body.problem).toEqual({
            code: 'no_net_result',
            bookName: 'Test Ledger',
            canOrganize: false,
            incoming: ['Revenue'],
            outgoing: ['Expenses', 'Travel'],
            shared: ['Expenses', 'Travel'],
        });
        expect(test.queries).toEqual([]);
    });

    it('answers a report of a group that mixes balances with activity with what to organize', async () => {
        const ledger = fixtureLedger();
        for (const account of ledger.book.accounts ?? []) {
            if (account.id === 'a-salary') {
                account.groups = [...(account.groups ?? []), { id: 'g-assets' }];
            }
        }
        const test = harness({ bkper: new FakeBkper({ ledger, permission: 'EDITOR' }) });
        const response = await post(test, {
            intent: { root: 'g-assets', period: p('today'), monthly: false },
            format: 'html',
        });
        expect(response.status).toBe(422);
        const body = (await response.json()) as {
            error: { code: string; message: string };
            problem: unknown;
        };
        expect(body.error.code).toBe('mixed_group');
        expect(body.error.message).toContain('groups only');
        expect(body.problem).toEqual({
            code: 'mixed_group',
            bookName: 'Test Ledger',
            canOrganize: true,
            group: 'Assets',
        });
        expect(test.queries).toEqual([]);
    });

    it('answers a report of an empty Book with what to do, before Bkper AI', async () => {
        const ledger = fixtureLedger();
        for (const account of ledger.book.accounts ?? []) {
            account.hasTransactionPosted = false;
        }
        const test = harness({ bkper: new FakeBkper({ ledger }) });
        const response = await post(test, { prompt: 'expenses last month' });
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({
            error: { code: 'empty_book' },
            problem: { code: 'empty_book', canOrganize: false },
        });
        expect(test.jevCalls).toBe(0);
    });

    it('builds a report by prompt with one Bkper AI decision', async () => {
        const test = harness({ jev: { root: 'Revenue', period: '2026-10', language: 'es' } });
        const response = await post(test, { prompt: 'ingresos de octubre' });

        expect(response.status).toBe(200);
        expect(test.jevCalls).toBe(1);
        expect(await response.json()).toMatchObject({
            intent: { root: 'g-revenue', period: p('2026-10'), monthly: false },
            language: 'es',
            query: "group:'Revenue' on:2026-10 by:m",
            // The report's own text, which builds the same report as a prompt; the link keeps
            // the person's words.
            text: 'Revenue octubre de 2026',
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
        const intent = { root: 'g-expenses', period: p('2026-10'), monthly: false };
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
        // The trace is for callers of the API, not for the person reading the file.
        expect(html).not.toContain('"trace"');
        expect(Object.keys(data)).not.toContain('trace');
        expect(elementOf(data.spec, 'Source').on).toBeUndefined();
        expect(data.link).toEqual({
            url: `https://report.bkper.app/?book=${BOOK}&q=Expenses+October+2026`,
            label: 'Open in Report',
        });
        // Where the Agent lets it, the file opens the same report in the Report app in the Book.
        expect(data.open?.bookId).toBe(BOOK);
        const opened = { text: 'Expenses October 2026', language: 'en' };
        expect(decodeUrlState(data.open?.state ?? '')).toEqual(opened);
        // A chart chosen in the file opens as that chart: each other chart that fits has a state.
        const choices = elementOf(data.spec, 'Visualizations').props;
        const others = choices.views.map(view => view.kind).filter(kind => kind !== choices.main);
        expect(Object.keys(data.open?.charts ?? {}).sort()).toEqual([...others].sort());
        for (const kind of others) {
            expect(decodeUrlState(data.open?.charts?.[kind] ?? '')).toEqual({
                ...opened,
                chart: kind,
            });
        }
        expect(timings(response)).toEqual([
            'user',
            'kv',
            'book',
            'balances',
            'compute',
            'render',
            'total',
        ]);
    });

    it('draws the chart a request asks for, and the file opens the report with it', async () => {
        const test = harness();
        const intent = { root: 'g-expenses', period: p('2026-10'), monthly: false };
        const response = await post(test, { intent, chart: 'ranked-bar', language: 'en' });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            chart: { kind: 'ranked-bar', fallback: false },
            text: 'Expenses October 2026',
        });

        const file = await post(test, { intent, chart: 'ranked-bar', format: 'html' });
        const data = JSON.parse(
            /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(
                await file.text()
            )?.[1] ?? ''
        ) as ReportFileData;
        expect(decodeUrlState(data.open?.state ?? '')).toEqual({
            text: 'Expenses October 2026',
            language: 'en',
            chart: 'ranked-bar',
        });

        const invalid = await post(test, { intent, chart: 'radar' });
        expect(invalid.status).toBe(400);
    });

    it('builds a report of a group target from its own queries, titled by the target', async () => {
        const test = harness();
        const intent = { root: 'g-assets', target: 'g-banks', period: p('today'), monthly: false };
        const response = await post(test, { intent, language: 'en' });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { spec: ReportSpec } & Record<string, unknown>;
        expect(body).toMatchObject({ intent, query: "group:'Banks' before:$d+1 by:m" });
        expect(elementOf(body.spec, 'Report').props.title).toBe('Banks');
        expect(elementOf(body.spec, 'Answer').props.amount).toBe('7749.25');
        expect(test.queries).toEqual([
            "group:'Banks' before:$d+1 by:m",
            "group:'Banks' before:$m by:m",
        ]);

        // The report file opens the same target again.
        const file = await post(test, { intent, language: 'en', format: 'html' });
        const data = JSON.parse(
            /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(
                await file.text()
            )?.[1] ?? ''
        ) as ReportFileData;
        // By its own text, which asks for the same report.
        expect(decodeUrlState(data.open?.state ?? '')).toEqual({
            text: body.text,
            language: 'en',
        });
    });

    it('shows targets side by side, one query per group, and opens them again by text', async () => {
        const test = harness();
        const intent = {
            root: 'g-expenses',
            target: 'a-food',
            alongside: [{ root: 'g-revenue' }, { root: 'g-expenses', target: 'a-rent' }],
            period: p('last_month'),
            monthly: false,
        };
        const response = await post(test, { intent, language: 'en' });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { spec: ReportSpec } & Record<string, unknown>;
        expect(body).toMatchObject({
            intent,
            query: "(account:'Food' OR group:'Revenue' OR account:'Rent') on:$m-1 by:m",
            trace: { facts: { sideBySide: true } },
        });
        const answers = Object.values(body.spec.elements).flatMap(element =>
            element.type === 'Answer' ? [[element.props.label, element.props.amount]] : []
        );
        expect(answers).toEqual([
            ['Food', '200.5'],
            ['Revenue', '5000'],
            ['Rent', '1000'],
        ]);
        expect([...test.queries].sort()).toEqual([
            "group:'Expenses' on:$m-1 by:m",
            "group:'Expenses' on:$m-2 by:m",
            "group:'Revenue' on:$m-1 by:m",
            "group:'Revenue' on:$m-2 by:m",
        ]);

        const file = await post(test, { intent, language: 'en', format: 'html' });
        const data = JSON.parse(
            /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(
                await file.text()
            )?.[1] ?? ''
        ) as ReportFileData;
        // By its own text, which asks for the same report.
        expect(decodeUrlState(data.open?.state ?? '')).toEqual({
            text: body.text,
            language: 'en',
        });
    });

    it('builds a report of an account in no group with a query of its own', async () => {
        const test = harness();
        const response = await post(test, {
            intent: { root: 'a-owner', period: p('today'), monthly: false },
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            query: "account:'Owner' before:$d+1 by:m",
        });
        expect(test.queries).toEqual([
            "account:'Owner' before:$d+1 by:m",
            "account:'Owner' before:$m by:m",
        ]);
    });

    it('answers upstream_error, never zero, when Bkper does not find an account by its name', async () => {
        const ledger = fixtureLedger();
        const answer = ledger.balances.bind(ledger);
        // Bkper answers no balances at all for an account it does not find.
        ledger.balances = query =>
            query.startsWith('account:') ? { periodicity: 'MONTHLY' } : answer(query);
        const test = harness({ bkper: new FakeBkper({ ledger }) });
        const response = await post(test, {
            intent: { root: 'a-owner', period: p('today'), monthly: false },
        });

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ error: { code: 'upstream_error' } });
    });

    it('reads a hashtag report with queries filtered by its hashtags', async () => {
        const test = harness({ jev: { root: 'Expenses', period: 'last_month' } });
        const response = await post(test, { prompt: 'expenses last month #trip' });

        expect(response.status).toBe(200);
        expect(test.queries).toEqual([
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
        ]);
        expect(await response.json()).toMatchObject({
            intent: { hashtags: ['trip'] },
            query: "group:'Expenses' #trip on:$m-1 by:m",
        });
    });

    it.each([
        ['neither prompt nor intent', {}],
        [
            'both prompt and intent',
            { prompt: 'x', intent: { root: 'r', period: p('all'), monthly: false } },
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
            { prompt: 'x', intent: { root: 'r', period: p('all'), monthly: false } },
            'Send exactly one of `prompt` or `intent`.',
        ],
        [{ prompt: 'expenses', format: 'pdf' }, 'format: '],
        [{ intent: { root: 'g-expenses', period: 'soon', monthly: false } }, 'intent.period: '],
        [
            { intent: { root: 'g-expenses', period: { month: 13 }, monthly: false } },
            'intent.period',
        ],
        [
            {
                intent: {
                    root: 'g-expenses',
                    period: { year: 2023 },
                    compared: {},
                    monthly: false,
                },
            },
            'intent.compared',
        ],
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
        expect(body.suggestions).toEqual([
            'Net income this year',
            'Assets today',
            'Expenses by month this year',
        ]);
    });

    it.each([
        ['future_period', { root: 'g-expenses', period: p('2099'), monthly: false }],
        ['unknown_root', { root: 'g-missing', period: p('this_year'), monthly: false }],
        [
            'unknown_target',
            { root: 'g-expenses', target: 'a-salary', period: p('this_year'), monthly: false },
        ],
        [
            'mixed_targets',
            {
                root: 'g-expenses',
                alongside: [{ root: 'g-assets' }],
                period: p('this_year'),
                monthly: false,
            },
        ],
    ])('answers %s for an intent the Book cannot have', async (code, intent) => {
        const test = harness();
        const response = await post(test, { intent });

        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ error: { code } });
        expect(test.queries).toEqual([]);
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
        expect(timings(response)).toEqual(['user', 'kv', 'book', 'total']);
    });

    it('requires a permission that can read balances', async () => {
        const test = harness({ bkper: new FakeBkper({ permission: 'RECORDER' }) });
        const response = await post(test, { prompt: 'expenses' });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
        expect(test.jevCalls).toBe(0);
    });
});
