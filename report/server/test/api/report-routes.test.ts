import { decodeReportState } from 'report-shared/report-state';
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
            period: choice(answers.period ?? 'unspecified'),
            over_time: { type: 'noul', noul: 0.01 },
            composition: { type: 'noul', noul: 0.01 },
            versus_earlier: { type: 'noul', noul: 0.01 },
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
        // This year has movements: the suggestions read only their reports' own queries (a
        // position today never moves, so it reads none here), in parallel.
        expect(timings(response)).toEqual(['user', 'kv', 'book', 'compute', 'balances', 'total']);
        expect([...test.queries].sort()).toEqual([
            "group:'Expenses' after:2025-01-01 before:2025-11-06 by:m",
            "group:'Expenses' after:2026-01-01 before:2026-11-06 by:m",
            "group:'Net income' after:2025-01-01 before:2025-11-06 by:m",
            "group:'Net income' after:2026-01-01 before:2026-11-06 by:m",
        ]);

        const warm = await test.app.request(SUGGESTIONS_URL, {}, test.env);
        expect(warm.status).toBe(200);
        expect(test.bkper.bookLoads).toBe(1);
        expect(timings(warm)).toEqual(['user', 'kv', 'compute', 'total']);
        expect(test.queries).toHaveLength(4);
    });

    it('suggests the last year with movements of a Book with only old data, and its reports are read', async () => {
        // Years after the fixture's last movements, in November 2026.
        vi.setSystemTime(new Date('2028-03-10T15:00:00Z'));
        try {
            const test = harness();
            const response = await test.app.request(SUGGESTIONS_URL, {}, test.env);
            const { suggestions } = (await response.json()) as {
                suggestions: { text: string; intent: unknown }[];
            };
            expect(suggestions.map(suggestion => suggestion.text)).toEqual([
                'Net result in 2026',
                'Expenses by month in 2026',
                'Assets today',
            ]);
            const read = test.queries.length;

            // Their reports, asked for by intent as the client prefetches them, show the
            // Book's data, from the balances the suggestions read.
            const expenses = await post(test, { intent: suggestions[1].intent });
            const body = (await expenses.json()) as { spec: ReportSpec };
            expect(elementOf(body.spec, 'Answer').props.amount).not.toBe('0');
            expect(test.queries).toHaveLength(read);
        } finally {
            vi.setSystemTime(NOW);
        }
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
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
        ]);
    });

    it('reuses the balances of the same queries within a minute, for the same user', async () => {
        const test = harness();
        const october = { root: 'g-expenses', period: '2026-10', monthly: false };
        const first = await post(test, { intent: october });
        // Last month is October too: the same queries.
        const again = await post(test, { intent: { ...october, period: 'last_month' } });
        // September is October's previous period: only its own previous one is read.
        await post(test, { intent: { ...october, period: '2026-09' } });

        expect([first.status, again.status]).toEqual([200, 200]);
        expect(test.queries).toEqual([
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
            "group:'Expenses' after:2026-08-01 before:2026-09-01 by:m",
        ]);
        expect(((await again.json()) as { dataAt: string }).dataAt).toBe(
            ((await first.json()) as { dataAt: string }).dataAt
        );
    });

    it('draws the chart an intent prefers, and tells when it does not fit', async () => {
        const test = harness();
        const ask = async (chart: string) => {
            const intent = { root: 'g-expenses', period: '2026-10', monthly: false, chart };
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
            intent: { root: 'g-expenses', period: '2026-10', monthly: false, chart: 'area' },
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
            intent: { root: 'g-expenses', period: '2026-10', monthly: false, chart: 'bars' },
        });
        expect(invalid.status).toBe(400);
    });

    it('still takes a waterfall, and offers the closest chart with why it draws none', async () => {
        const test = harness();
        const intent = {
            root: 'net-result',
            period: '2026-10',
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
        const intent = { root: 'net-result', period: '2026-10', monthly: false };
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
            intent: { root: 'net-result', period: '2026-10', monthly: false },
        });
        expect(response.status).toBe(422);
        const body = (await response.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe('no_net_result');
        expect(body.error.message).toContain('add one in Bkper');
        expect(test.queries).toEqual([]);
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
        expect(decodeReportState(data.open?.state ?? '')).toEqual({ intent, language: 'en' });
        // A chart chosen in the file opens as that chart: each other chart that fits has a state.
        const choices = elementOf(data.spec, 'Visualizations').props;
        const others = choices.views.map(view => view.kind).filter(kind => kind !== choices.main);
        expect(Object.keys(data.open?.charts ?? {}).sort()).toEqual([...others].sort());
        for (const kind of others) {
            expect(decodeReportState(data.open?.charts?.[kind] ?? '')).toEqual({
                intent: { ...intent, chart: kind },
                language: 'en',
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

    it('builds a report of a group target from its own queries, titled by the target', async () => {
        const test = harness();
        const intent = { root: 'g-assets', target: 'g-banks', period: 'today', monthly: false };
        const response = await post(test, { intent, language: 'en' });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { spec: ReportSpec } & Record<string, unknown>;
        expect(body).toMatchObject({ intent, query: "group:'Banks' before:2026-11-06" });
        expect(elementOf(body.spec, 'Report').props.title).toBe('Banks');
        expect(elementOf(body.spec, 'Answer').props.amount).toBe('7749.25');
        expect(test.queries).toEqual([
            "group:'Banks' after:2026-11-05 before:2026-11-06 by:m",
            "group:'Banks' before:2026-11-01 by:m",
        ]);

        // The report file opens the same target again.
        const file = await post(test, { intent, language: 'en', format: 'html' });
        const data = JSON.parse(
            /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(
                await file.text()
            )?.[1] ?? ''
        ) as ReportFileData;
        expect(decodeReportState(data.open?.state ?? '')).toEqual({ intent, language: 'en' });
    });

    it('shows targets side by side, one query per group, and opens them again by state', async () => {
        const test = harness();
        const intent = {
            root: 'g-expenses',
            target: 'a-food',
            alongside: [{ root: 'g-revenue' }, { root: 'g-expenses', target: 'a-rent' }],
            period: 'last_month',
            monthly: false,
        };
        const response = await post(test, { intent, language: 'en' });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { spec: ReportSpec } & Record<string, unknown>;
        expect(body).toMatchObject({
            intent,
            query: "(account:'Food' OR group:'Revenue' OR account:'Rent') after:2026-10-01 before:2026-11-01",
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
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Revenue' after:2026-09-01 before:2026-10-01 by:m",
            "group:'Revenue' after:2026-10-01 before:2026-11-01 by:m",
        ]);

        const file = await post(test, { intent, language: 'en', format: 'html' });
        const data = JSON.parse(
            /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(
                await file.text()
            )?.[1] ?? ''
        ) as ReportFileData;
        expect(decodeReportState(data.open?.state ?? '')).toEqual({ intent, language: 'en' });
    });

    it('builds a report of an account in no group with a query of its own', async () => {
        const test = harness();
        const response = await post(test, {
            intent: { root: 'a-owner', period: 'today', monthly: false },
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            query: "account:'Owner' before:2026-11-06",
        });
        expect(test.queries).toEqual([
            "account:'Owner' after:2026-11-05 before:2026-11-06 by:m",
            "account:'Owner' before:2026-11-01 by:m",
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
            intent: { root: 'a-owner', period: 'today', monthly: false },
        });

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ error: { code: 'upstream_error' } });
    });

    it('reads a hashtag report with queries filtered by its hashtags', async () => {
        const test = harness({ jev: { root: 'Expenses', period: 'last_month' } });
        const response = await post(test, { prompt: 'expenses last month #trip' });

        expect(response.status).toBe(200);
        expect(test.queries).toEqual([
            "group:'Expenses' #trip after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' #trip after:2026-09-01 before:2026-10-01 by:m",
        ]);
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
        [
            'unknown_target',
            { root: 'g-expenses', target: 'a-salary', period: 'this_year', monthly: false },
        ],
        [
            'mixed_targets',
            {
                root: 'g-expenses',
                alongside: [{ root: 'g-assets' }],
                period: 'this_year',
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
