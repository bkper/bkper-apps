import { describe, expect, it } from 'vitest';
import { BkperAiError, createDecisionClient } from '../../src/services/decision-client';
import { ReportError } from '../../src/services/report';
import type { ReportIntent } from '../../src/services/report-intent';
import {
    NotAReportError,
    createReport,
    type ReportServiceOptions,
} from '../../src/services/report-service';
import type { Snapshot } from '../../src/services/snapshot';
import { buildSuggestions } from '../../src/services/suggestions';
import { ServerTiming } from '../../src/services/timing';
import {
    fixtureLedger,
    fixtureSnapshot,
    ledgerBalances,
    ledgerSnapshot,
    simpleRootsLedger,
} from '../fixtures/snapshot-book';

const NOW = new Date('2026-11-05T16:00:00Z');

interface JevAnswers {
    root: string;
    period?: string;
    over_time?: number;
    chart_named?: string;
    language?: string;
    rootConfidence?: number;
}

function jevBody(answers: JevAnswers) {
    const choice = (value: string, confidence = 0.99) => ({
        type: 'choice',
        choice: value,
        confidence,
        probabilities: { [value]: confidence },
    });
    return {
        model: 'jev',
        answers: {
            root: choice(answers.root, answers.rootConfidence),
            period: choice(answers.period ?? 'unspecified'),
            over_time: { type: 'noul', noul: answers.over_time ?? 0.01 },
            composition: { type: 'noul', noul: 0.01 },
            versus_earlier: { type: 'noul', noul: 0.01 },
            bridge: { type: 'noul', noul: 0.01 },
            chart_named: choice(answers.chart_named ?? 'none'),
            language: choice(answers.language ?? 'en'),
        },
        usage: { input_tokens: 1000, output_tokens: 10 },
    };
}

interface Harness {
    options: ReportServiceOptions & { timing: ServerTiming };
    jevCalls: number;
    queries: string[];
    /** Events in the order they started. */
    events: string[];
}

function harness(answers: JevAnswers | (() => Response) = { root: 'Expenses' }): Harness {
    const ledger = fixtureLedger();
    const state: Harness = {
        jevCalls: 0,
        queries: [],
        events: [],
        options: {
            decisions: createDecisionClient({
                fetch: async () => {
                    state.jevCalls++;
                    state.events.push('jev');
                    // Answer only after anything started in parallel has started.
                    await new Promise(resolve => setTimeout(resolve, 5));
                    return typeof answers === 'function'
                        ? answers()
                        : Response.json(jevBody(answers));
                },
            }),
            loadBalances: async queries => {
                state.queries.push(...queries);
                state.events.push('balances');
                return queries.map(query => ledgerBalances(ledger, query, NOW));
            },
            timing: new ServerTiming(),
        },
    };
    return state;
}

const intent = (root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent => ({
    root,
    period,
    monthly: false,
    ...extra,
});

describe('createReport by intent', () => {
    it('builds the spec without asking Jev, in the requested language', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-expenses', '2026-10') },
            { requested: 'pt', accepted: 'de' },
            test.options
        );

        expect(test.jevCalls).toBe(0);
        // The period and the previous one, together.
        expect(test.queries).toEqual([
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', '2026-10'));
        expect(result.language).toBe('pt');
        expect(result.query).toBe("group:'Expenses' after:2026-10-01 before:2026-11-01");
        expect(result.dataAt).toBe(NOW.toISOString());
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '1200.5' } });
        expect(result.spec.elements[result.spec.root]).toMatchObject({
            type: 'Report',
            props: { title: 'Expenses', locale: 'pt' },
        });
        expect(result.text).toBe('Expenses outubro de 2026');
        expect(test.options.timing.header()).toMatch(/^compute;dur=[\d.]+, render;dur=[\d.]+$/);
    });

    it('writes a report as a request without the isolates of its dates', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-assets', 'today') },
            { requested: 'en' },
            test.options
        );

        expect(result.text).toBe('Assets As of Nov 5, 2026');
    });

    it('falls back to the accepted language, then English', async () => {
        const snapshot = await fixtureSnapshot();
        const request = { intent: intent('g-assets', 'today') };
        const accepted = await createReport(
            snapshot,
            request,
            { accepted: 'de' },
            harness().options
        );
        const none = await createReport(snapshot, request, {}, harness().options);

        expect(accepted.language).toBe('de');
        expect(none.language).toBe('en');
    });

    it('filters the queries of a hashtag intent by its hashtags', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-expenses', 'last_month', { hashtags: ['trip'] }) },
            {},
            test.options
        );

        expect(test.queries).toEqual([
            "group:'Expenses' #trip after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' #trip after:2026-09-01 before:2026-10-01 by:m",
        ]);
        expect(result.query).toBe("group:'Expenses' #trip after:2026-10-01 before:2026-11-01");
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '200.5' } });
    });

    it('reads today with ordinary period queries', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-expenses', 'today') },
            {},
            test.options
        );

        expect(test.queries).toEqual([
            "group:'Expenses' after:2026-11-05 before:2026-11-06 by:m",
            "group:'Expenses' after:2026-11-04 before:2026-11-05 by:m",
        ]);
        expect(result.query).toBe("group:'Expenses' after:2026-11-05 before:2026-11-06");
    });

    it('rejects intents the Book cannot have', async () => {
        const snapshot = await fixtureSnapshot();
        const error = await createReport(
            snapshot,
            { intent: intent('g-expenses', '2099') },
            {},
            harness().options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ReportError);
        expect(error).toMatchObject({ reason: 'future_period' });
    });

    it('has no net result without activity roots, and suggests other reports', async () => {
        const snapshot: Snapshot = { ...(await fixtureSnapshot()), roots: ['g-assets'] };
        const error = await createReport(
            snapshot,
            { intent: intent('net-result', 'this_year') },
            { requested: 'en' },
            harness().options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotAReportError);
        expect(error).toMatchObject({ suggestions: buildSuggestions(snapshot, 'en') });
    });

    it('has no net result when no group combines Incoming and Outgoing and roots share accounts', async () => {
        const snapshot = await fixtureSnapshot();
        // Expenses and Revenue stay; Net income shares their accounts but no longer combines.
        snapshot.groups['g-net'] = { ...snapshot.groups['g-net'], type: 'OUTGOING' };
        const test = harness();
        const error = await createReport(
            snapshot,
            { intent: intent('net-result', 'this_year') },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ReportError);
        expect(error).toMatchObject({ reason: 'no_net_result' });
        expect(test.queries).toEqual([]);
    });
});

describe('createReport by prompt', () => {
    it('asks Jev once and reports in the language it detected', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10', language: 'es' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'gastos en octubre' },
            { accepted: 'de' },
            test.options
        );

        expect(test.jevCalls).toBe(1);
        expect(result.intent).toEqual(intent('g-expenses', '2026-10'));
        expect(result.language).toBe('es');
        expect(result.text).toBe('gastos en octubre');
        expect(test.options.timing.header()).toMatch(/^jev;dur=.*compute;dur=.*render;dur=/);
    });

    it('draws the chart the prompt asked for', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10', chart_named: 'table' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses in October, just the numbers' },
            {},
            test.options
        );
        expect(result.intent).toEqual(intent('g-expenses', '2026-10', { chart: 'table' }));
        expect(result.chart).toEqual({ kind: 'none', fallback: false });
    });

    it('traces the judgments of a request and the rule that chose its chart', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10', chart_named: 'table' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses in October, just the numbers' },
            {},
            test.options
        );
        expect(result.trace).toMatchObject({
            judgments: {
                root: { answer: 'Expenses', score: 0.99 },
                period: { answer: '2026-10', score: 0.99 },
                over_time: { answer: false, score: 0.01 },
                composition: { answer: false, score: 0.01 },
                versus_earlier: { answer: false, score: 0.01 },
                bridge: { answer: false, score: 0.01 },
                chart_named: { answer: 'table', score: 0.99 },
                language: { answer: 'en', score: 0.99 },
            },
            rule: 'named',
            chart: { main: 'table', rule: 'preference' },
        });
    });

    it('traces the facts, the charts that fit and the rule that chose the main one', async () => {
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('net-result', '2026-10', { chart: 'pie' }) },
            {},
            harness().options
        );
        // The net result of the group that combines Incoming and Outgoing: Salary, Rent, Food.
        expect(result.trace).toEqual({
            facts: {
                rows: 3,
                negative: 0,
                mixed: true,
                months: 1,
                previous: true,
                net: true,
                permanent: false,
            },
            chart: {
                fitting: ['bar', 'ranked-bar', 'compare', 'table'],
                main: 'ranked-bar',
                rule: 'closest',
                unfit: { kind: 'pie', reason: { code: 'net_result' } },
            },
        });
        expect(result.chart).toEqual({ kind: 'ranked-bar', fallback: true });
        // An intent asks no judgments.
        expect(result.trace).not.toHaveProperty('judgments');
        expect(result.trace).not.toHaveProperty('rule');
    });

    it('prefers the requested language over the detected one', async () => {
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'gastos en octubre' },
            { requested: 'fr' },
            harness({ root: 'Expenses', language: 'es' }).options
        );
        expect(result.language).toBe('fr');
    });

    it('reads the balances of the period Jev chose, after it answers', async () => {
        const test = harness({ root: 'Expenses', period: 'last_month' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses last month #trip' },
            {},
            test.options
        );

        expect(test.events).toEqual(['jev', 'balances']);
        expect(test.queries).toEqual([
            "group:'Expenses' #trip after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' #trip after:2026-09-01 before:2026-10-01 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', 'last_month', { hashtags: ['trip'] }));
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '200.5' } });
    });

    it('reports the group or account the prompt names, titled by it, from its group', async () => {
        // Jev chose another root: the name the prompt writes decides.
        const test = harness({ root: 'Revenue', period: '2026-10', language: 'pt' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'quanto gastei com food em outubro' },
            {},
            test.options
        );
        expect(test.jevCalls).toBe(1);
        expect(result.intent).toEqual(intent('g-expenses', '2026-10', { target: 'a-food' }));
        expect(test.queries).toEqual([
            "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m",
            "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m",
        ]);
        expect(result.spec.elements[result.spec.root]).toMatchObject({
            props: { title: 'Food' },
        });
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '200.5' } });
        expect(result.query).toBe("account:'Food' after:2026-10-01 before:2026-11-01");
        expect(result.trace).toMatchObject({ names: ['Food'] });
        expect(result.text).toBe('quanto gastei com food em outubro');
    });

    it('shows the names a prompt writes side by side, each its own balance', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'Rent versus Food in October' },
            {},
            test.options
        );
        expect(result.intent).toMatchObject({
            root: 'g-expenses',
            target: 'a-rent',
            alongside: [{ root: 'g-expenses', target: 'a-food' }],
        });
        expect(result.spec.elements['answer-1']).toMatchObject({ props: { amount: '1000' } });
        expect(result.spec.elements['answer-2']).toMatchObject({ props: { amount: '200.5' } });
    });

    it('rejects positions and activity named side by side', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10' });
        const error = await createReport(
            await fixtureSnapshot(),
            { prompt: 'cash and food in October' },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ReportError);
        expect(error).toMatchObject({ reason: 'mixed_targets' });
        expect(test.queries).toEqual([]);
    });

    it('returns suggestions in the detected language when the prompt is not a report', async () => {
        const snapshot = await fixtureSnapshot();
        const test = harness({ root: 'none', language: 'en' });
        const error = await createReport(
            snapshot,
            { prompt: 'what is the weather #today' },
            { accepted: 'de' },
            test.options
        ).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(NotAReportError);
        expect(error).toMatchObject({ suggestions: buildSuggestions(snapshot, 'en') });
        expect(String(error)).not.toContain('weather');
    });

    it('lets Bkper AI failures through for the API to map', async () => {
        const failure = () =>
            Response.json(
                {
                    error: {
                        message: 'Allowance exhausted',
                        type: 'rate_limit',
                        param: null,
                        code: 'usage_limit_exceeded',
                    },
                },
                { status: 429 }
            );
        const error = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses #trip' },
            {},
            harness(failure).options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BkperAiError);
        expect(error).toMatchObject({ code: 'usage_limit_exceeded' });
    });
});

describe('createReport of a request that names no period', () => {
    /** The fixture read in March 2028: its last movements, in November 2026, are then old. */
    const LATER = '2028-03-10';
    const later = async (): Promise<Snapshot> => ({ ...(await fixtureSnapshot()), today: LATER });

    it('reads this year when it has movements, with no other query', async () => {
        const test = harness({ root: 'Expenses' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses' },
            {},
            test.options
        );
        expect(result.intent).toEqual(intent('g-expenses', 'this_year'));
        expect(test.queries).toEqual([
            "group:'Expenses' after:2026-01-01 before:2026-11-06 by:m",
            "group:'Expenses' after:2025-01-01 before:2025-11-06 by:m",
        ]);
    });

    it('reads the last year with movements when this year has none, after one more query', async () => {
        const test = harness({ root: 'Expenses' });
        const result = await createReport(await later(), { prompt: 'expenses' }, {}, test.options);
        expect(test.queries).toEqual([
            "group:'Expenses' after:2028-01-01 before:2028-03-11 by:m",
            "group:'Expenses' after:2027-01-01 before:2027-03-11 by:m",
            // The one query of the root's history, to find its last movements.
            "group:'Expenses' before:2028-03-11 by:m",
            "group:'Expenses' after:2026-01-01 before:2027-01-01 by:m",
            "group:'Expenses' after:2025-01-01 before:2026-01-01 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', '2026'));
        // The report of that year, every amount Bkper's.
        const byIntent = await createReport(
            await later(),
            { intent: intent('g-expenses', '2026') },
            {},
            harness().options
        );
        expect(result.spec).toEqual(byIntent.spec);
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '3250.75' } });
    });

    it('reads a trend of the last year with movements when the last 12 months have none', async () => {
        const test = harness({ root: 'Expenses', over_time: 0.99 });
        const result = await createReport(
            await later(),
            { prompt: 'expenses over time' },
            {},
            test.options
        );
        expect(test.queries.slice(2)).toEqual([
            "group:'Expenses' before:2028-03-11 by:m",
            "group:'Expenses' after:2026-01-01 before:2027-01-01 by:m",
            "group:'Expenses' after:2025-01-01 before:2026-01-01 by:m",
        ]);
        expect(result.intent).toEqual(
            intent('g-expenses', '2026', { monthly: true, view: 'trend' })
        );
    });

    it('reads a name from its group’s history, as its report reads it', async () => {
        const test = harness({ root: 'Revenue' });
        const result = await createReport(await later(), { prompt: 'food' }, {}, test.options);
        expect(test.queries[2]).toBe("group:'Expenses' before:2028-03-11 by:m");
        expect(result.intent).toEqual(intent('g-expenses', '2026', { target: 'a-food' }));
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '250.75' } });
    });

    it('keeps the default period when the history has no movements either', async () => {
        const test = harness({ root: 'Expenses' });
        const result = await createReport(
            await later(),
            { prompt: 'expenses #nothing' },
            {},
            test.options
        );
        expect(test.queries).toEqual([
            "group:'Expenses' #nothing after:2028-01-01 before:2028-03-11 by:m",
            "group:'Expenses' #nothing after:2027-01-01 before:2027-03-11 by:m",
            "group:'Expenses' #nothing before:2028-03-11 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', 'this_year', { hashtags: ['nothing'] }));
    });

    it('suggests reports of the last year with movements when the request is not one', async () => {
        const test = harness({ root: 'none', language: 'en' });
        const error = await createReport(
            await later(),
            { prompt: 'what is the weather' },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotAReportError);
        const { suggestions } = error as NotAReportError;
        expect(suggestions.map(suggestion => suggestion.intent.period)).toEqual([
            '2026',
            '2026',
            'today',
        ]);
        expect(suggestions[1].text).toBe('Expenses by month in 2026');
    });

    it('reads a position today, whenever it last moved, with no other query', async () => {
        const test = harness({ root: 'Assets' });
        const result = await createReport(await later(), { prompt: 'assets' }, {}, test.options);
        expect(result.intent).toEqual(intent('g-assets', 'today'));
        expect(test.queries).toHaveLength(2);
    });

    it('keeps a period the request names, with movements or not', async () => {
        const named = harness({ root: 'Expenses', period: '2027' });
        const result = await createReport(
            await later(),
            { prompt: 'expenses in 2027' },
            {},
            named.options
        );
        expect(result.intent).toEqual(intent('g-expenses', '2027'));
        expect(named.queries).toHaveLength(2);

        // An intent always names its period, as a suggestion's does.
        const byIntent = harness();
        const suggested = await createReport(
            await later(),
            { intent: intent('g-expenses', 'this_year', { monthly: true }) },
            {},
            byIntent.options
        );
        expect(suggested.intent.period).toBe('this_year');
        expect(byIntent.queries).toHaveLength(2);
    });
});

describe('the history of a request that names no period', () => {
    it('reads one root only, the first subject’s, even for a net result Report calculates', async () => {
        const ledger = simpleRootsLedger();
        const snapshot = { ...(await ledgerSnapshot(ledger)), today: '2028-03-10' };
        const queries: string[] = [];
        const options: ReportServiceOptions = {
            ...harness({ root: 'net-result' }).options,
            loadBalances: async asked => {
                queries.push(...asked);
                return asked.map(query => ledgerBalances(ledger, query, NOW));
            },
        };
        const result = await createReport(snapshot, { prompt: 'profit' }, {}, options);
        expect(queries.filter(query => !query.includes('after:'))).toEqual([
            "group:'Expenses' before:2028-03-11 by:m",
        ]);
        expect(result.intent).toEqual(intent('net-result', '2026'));
    });
});
