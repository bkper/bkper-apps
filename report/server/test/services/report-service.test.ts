import { periodRequestOf, type PeriodParts } from 'report-shared/report-intent';
import { addLocale } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { BkperAiError, createDecisionClient } from '../../src/services/decision-client';
import { ReportError } from '../../src/services/report';
import { reportIntentOf, type ReportIntent } from '../../src/services/report-intent';
import {
    NotAReportError,
    createReport,
    type ReportServiceOptions,
} from '../../src/services/report-service';
import type { Snapshot } from '../../src/services/snapshot';
import { buildSuggestions } from '../../src/services/suggestions';
import { ServerTiming } from '../../src/services/timing';
import {
    TODAY,
    fixtureLedger,
    fixtureSnapshot,
    ledgerBalances,
    ledgerSnapshot,
    simpleRootsLedger,
} from '../fixtures/snapshot-book';
import { asksRanking, rankingResponse } from '../fixtures/suggestion-answers';

/** The fixture's suggestions as Jev ranks them in these tests (`FIXTURE_RANKING`). */
const RANKED = ['g-net', 'g-assets', 'g-expenses'];

/** The texts of the fixture's suggestions, in English, as Jev ranks them. */
const suggestionTexts = (snapshot: Snapshot): string[] =>
    buildSuggestions(snapshot, 'en', RANKED).map(suggestion => suggestion.text);
import { periodChoices } from '../fixtures/period-answers';

/** The parts of a period id, as intents now hold them. */
function p(id: string): PeriodParts {
    const request = periodRequestOf(id);
    if (!request) throw new Error(`Not a period id: ${id}`);
    return request.period;
}

const NOW = new Date('2026-11-05T16:00:00Z');

interface JevAnswers {
    root: string;
    period?: string;
    /** Labels of the period questions, over those of `period`. */
    periodChoices?: Partial<ReturnType<typeof periodChoices>>;
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
            ...Object.fromEntries(
                Object.entries({
                    ...periodChoices(answers.period),
                    ...answers.periodChoices,
                }).map(([id, label]) => [id, choice(label)])
            ),
            over_time: { type: 'noul', noul: answers.over_time ?? 0.01 },
            composition: { type: 'noul', noul: 0.01 },
            versus_earlier: { type: 'noul', noul: 0.01 },
            year_earlier: { type: 'noul', noul: 0.01 },
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
    /** Requests that ranked the suggestions. */
    rankings: number;
    queries: string[];
    /** Events in the order they started. */
    events: string[];
}

/** A report service on the fixture ledger, read on the Book's `today`. */
function harness(
    answers: JevAnswers | (() => Response) = { root: 'Expenses' },
    today = TODAY
): Harness {
    const ledger = fixtureLedger();
    ledger.today = today;
    const state: Harness = {
        jevCalls: 0,
        rankings: 0,
        queries: [],
        events: [],
        options: {
            decisions: createDecisionClient({
                fetch: async (_url, init) => {
                    if (asksRanking(init)) {
                        state.rankings++;
                        return rankingResponse();
                    }
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

/** An intent, its period as parts, from a period id as older intents wrote it. */
const intent = (root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent =>
    reportIntentOf({ root, period, monthly: false, ...extra });

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
            "group:'Expenses' on:2026-10 by:m",
            "group:'Expenses' on:2026-09 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', '2026-10'));
        expect(result.language).toBe('pt');
        expect(result.query).toBe("group:'Expenses' on:2026-10 by:m");
        expect(result.dataAt).toBe(NOW.toISOString());
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '1200.5' } });
        expect(result.spec.elements[result.spec.root]).toMatchObject({
            type: 'Report',
            props: { title: 'Expenses', locale: 'pt' },
        });
        expect(result.text).toBe('Expenses outubro de 2026');
        expect(test.options.timing.header()).toMatch(/^compute;dur=[\d.]+, render;dur=[\d.]+$/);
    });

    it('writes a report as a request, its period as asked, without isolates', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-assets', 'today') },
            { requested: 'en' },
            test.options
        );

        expect(result.text).toBe('Assets now');
    });

    it('accepts the period id of an older intent, and answers with its parts', async () => {
        const result = await createReport(
            await fixtureSnapshot(),
            {
                intent: {
                    root: 'g-expenses',
                    period: 'last_year',
                    compareWith: 'year_earlier',
                    monthly: false,
                },
            },
            { requested: 'en' },
            harness().options
        );

        expect(result.intent).toEqual({
            root: 'g-expenses',
            period: { span: 'year', year: 'previous' },
            compareWith: 'year_earlier',
            monthly: false,
        });
        expect(result.query).toBe("group:'Expenses' on:$y-1 by:m");
    });

    it('compares as the intent names it, or says why it compares with the previous period', async () => {
        const snapshot = await fixtureSnapshot();
        const named = await createReport(
            snapshot,
            {
                intent: {
                    root: 'g-expenses',
                    period: { span: 'year', year: 'previous' },
                    compared: { year: 2023 },
                    monthly: false,
                },
            },
            { requested: 'en' },
            harness().options
        );
        expect(named.text).toBe('Expenses last year vs. 2023');
        expect(named.trace.comparisonError).toBeUndefined();

        const mismatch = await createReport(
            snapshot,
            {
                intent: {
                    root: 'g-expenses',
                    period: { span: 'year', year: 2025 },
                    compared: { month: 3 },
                    monthly: false,
                },
            },
            { requested: 'en' },
            harness().options
        );
        expect(mismatch.trace.comparisonError).toBe('comparison_kind_mismatch');
        const report = mismatch.spec.elements[mismatch.spec.root];
        expect(report.type === 'Report' && report.props.notice).toBeTruthy();
        // What was asked stays the intent's, so it can be asked again as said.
        expect(mismatch.intent.compared).toEqual({ month: 3 });
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
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
        ]);
        expect(result.query).toBe("group:'Expenses' #trip on:$m-1 by:m");
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '200.5' } });
    });

    it('reads activity today as this month', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-expenses', 'today') },
            {},
            test.options
        );

        expect(test.queries).toEqual([
            "group:'Expenses' on:$m by:m",
            "group:'Expenses' on:$m-1 by:m",
        ]);
        expect(result.query).toBe("group:'Expenses' on:$m by:m");
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
        expect(error).toMatchObject({ suggestions: suggestionTexts(snapshot) });
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

describe('createReport of a Book that has nothing to report', () => {
    it('answers an empty Book before asking Bkper AI or reading any balances', async () => {
        const snapshot = await fixtureSnapshot();
        for (const account of [
            ...Object.values(snapshot.accounts),
            ...Object.values(snapshot.ungrouped),
        ]) {
            account.posted = false;
        }
        for (const request of [
            { prompt: 'expenses last month' },
            { intent: intent('g-expenses', 'last_month') },
        ]) {
            const test = harness();
            const error = await createReport(snapshot, request, {}, test.options).catch(
                (e: unknown) => e
            );
            expect(error).toBeInstanceOf(ReportError);
            expect(error).toMatchObject({
                reason: 'empty_book',
                problem: { code: 'empty_book', bookName: 'Test Ledger', canOrganize: false },
            });
            expect(test.jevCalls).toBe(0);
            expect(test.queries).toEqual([]);
        }
    });

    it('answers a Book whose accounts are mostly in no group, even for one of them', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.roots = [];
        snapshot.groups = {};
        snapshot.ungrouped = { ...snapshot.ungrouped, ...snapshot.accounts };
        snapshot.accounts = {};
        const test = harness();
        const error = await createReport(
            snapshot,
            { intent: intent('a-owner', 'today') },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toMatchObject({
            reason: 'nothing_to_report',
            problem: { code: 'nothing_to_report', ungrouped: 9, total: 9 },
        });
        expect(test.queries).toEqual([]);
    });

    it('still answers a request that is no report of a Book that has reports as not a report', async () => {
        const test = harness({ root: 'none' });
        const error = await createReport(
            await fixtureSnapshot(),
            { prompt: 'what is the weather' },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotAReportError);
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
        expect(result.text).toBe('Expenses octubre de 2026');
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
        expect(result.chart).toEqual({ kind: 'none', fallback: false, asked: 'table' });
    });

    it('draws the chart the request asks for over the one the prompt names', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10', chart_named: 'table' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses in October, just the numbers', chart: 'ranked-bar' },
            {},
            test.options
        );
        expect(result.intent).toEqual(intent('g-expenses', '2026-10', { chart: 'ranked-bar' }));
        expect(result.chart).toEqual({ kind: 'ranked-bar', fallback: false, asked: 'ranked-bar' });
        // How to show a report is not what it is: its text names no chart.
        expect(result.text).toBe('Expenses October 2026');
    });

    it('shows a chart asked for that does not fit as the closest one that does', async () => {
        const test = harness({ root: 'Expenses', period: '2026-10' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses in October', chart: 'waterfall' },
            {},
            test.options
        );
        expect(result.intent.chart).toBe('waterfall');
        expect(result.chart.fallback).toBe(true);
        expect(result.trace.chart.unfit?.kind).toBe('waterfall');
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
                period: { answer: 'month', score: 0.99, read: 'month' },
                year: { answer: '2026', score: 0.99, read: 2026 },
                month: { answer: 'October', score: 0.99, read: 10 },
                over_time: { answer: false, score: 0.01 },
                composition: { answer: false, score: 0.01 },
                versus_earlier: { answer: false, score: 0.01 },
                year_earlier: { answer: false, score: 0.01 },
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
        expect(result.chart).toEqual({ kind: 'ranked-bar', fallback: true, asked: 'pie' });
        // An intent asks no judgments.
        expect(result.trace).not.toHaveProperty('judgments');
        expect(result.trace).not.toHaveProperty('rule');
    });

    it('answers that the next month has not started, reading no balances', async () => {
        const test = harness({
            root: 'Expenses',
            periodChoices: { span: 'month', month: 'next_month' },
        });
        const error = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses next month' },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ReportError);
        expect(error).toMatchObject({ reason: 'future_period' });
        expect(test.queries).toEqual([]);
    });

    it('reads the period a prompt compares with', async () => {
        const test = harness({
            root: 'Expenses',
            periodChoices: { span: 'year', year: 'last_year', compared_year: '2023' },
        });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses last year vs 2023' },
            {},
            test.options
        );
        expect(test.queries).toEqual([
            "group:'Expenses' on:$y-1 by:m",
            "group:'Expenses' on:2023 by:m",
        ]);
        expect(result.intent).toMatchObject({
            period: { span: 'year', year: 'previous' },
            compared: { year: 2023 },
        });
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
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', 'last_month', { hashtags: ['trip'] }));
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '200.5' } });
    });

    it('reads only the first hashtag of a prompt, as Bkper filters balances by exactly one', async () => {
        const test = harness({ root: 'Expenses', period: 'last_month' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses last month #trip #other' },
            {},
            test.options
        );

        expect(test.queries).toEqual([
            "group:'Expenses' #trip on:$m-1 by:m",
            "group:'Expenses' #trip on:$m-2 by:m",
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
            "group:'Expenses' on:2026-10 by:m",
            "group:'Expenses' on:2026-09 by:m",
        ]);
        expect(result.spec.elements[result.spec.root]).toMatchObject({
            props: { title: 'Food' },
        });
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '200.5' } });
        expect(result.query).toBe("account:'Food' on:2026-10 by:m");
        expect(result.trace).toMatchObject({ names: ['Food'] });
        expect(result.text).toBe('Food outubro de 2026');
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
        expect(error).toMatchObject({ suggestions: suggestionTexts(snapshot) });
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

describe('createReport of a suggestion’s text', () => {
    it('builds the suggestion’s report from its intent, asking Jev nothing of the request', async () => {
        const snapshot = await fixtureSnapshot();
        const test = harness();
        const result = await createReport(
            snapshot,
            { prompt: ' Expenses  by month\tthis year ' },
            {},
            test.options
        );

        expect(test.jevCalls).toBe(0);
        expect(result.intent).toEqual(buildSuggestions(snapshot, 'en', RANKED)[2].intent);
        expect(result.language).toBe('en');
        expect(result.query).toBe("group:'Expenses' after:$y before:$m+1 by:m");
        // The suggestions read their reports' queries; the report reads them no more.
        expect(test.queries).toHaveLength(new Set(test.queries).size);
    });

    it('draws a suggestion with the chart the request asks for', async () => {
        const snapshot = await fixtureSnapshot();
        const test = harness();
        const result = await createReport(
            snapshot,
            { prompt: 'Expenses by month this year', chart: 'area' },
            {},
            test.options
        );
        expect(test.jevCalls).toBe(0);
        expect(result.intent).toEqual({
            ...buildSuggestions(snapshot, 'en', RANKED)[2].intent,
            chart: 'area',
        });
        expect(result.chart.kind).toBe('area');
    });

    it('reads the suggestions in the language asked for, else the accepted one', async () => {
        addLocale('eo', { suggestion_position_today: '{root} hodiaŭ' });
        const snapshot = await fixtureSnapshot();
        const accepted = harness();
        const result = await createReport(
            snapshot,
            { prompt: 'Assets hodiaŭ' },
            { accepted: 'eo' },
            accepted.options
        );
        expect(accepted.jevCalls).toBe(0);
        expect(result.intent).toEqual(intent('g-assets', 'today'));
        expect(result.language).toBe('eo');

        // Asked for in Esperanto, the English text is any request.
        const other = harness({ root: 'Assets' });
        await createReport(
            snapshot,
            { prompt: 'Assets today' },
            { requested: 'eo', accepted: 'en' },
            other.options
        );
        expect(other.jevCalls).toBe(1);
    });

    it('builds a suggestion of the last year with movements, as it names it', async () => {
        const snapshot: Snapshot = { ...(await fixtureSnapshot()), today: '2028-03-10' };
        const test = harness(undefined, '2028-03-10');
        const result = await createReport(
            snapshot,
            { prompt: 'Expenses by month in 2026' },
            {},
            test.options
        );
        expect(test.jevCalls).toBe(0);
        expect(result.intent).toEqual(intent('g-expenses', '2026', { monthly: true }));
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '3250.75' } });
    });

    it('asks Jev for any other text, ranking no suggestions and reading none of theirs', async () => {
        const snapshot = await fixtureSnapshot();
        const test = harness({ root: 'Expenses', period: '2026-10' });
        await createReport(snapshot, { prompt: 'expenses in October' }, {}, test.options);
        expect(test.jevCalls).toBe(1);
        expect(test.rankings).toBe(0);
        expect(test.queries).toEqual([
            "group:'Expenses' on:2026-10 by:m",
            "group:'Expenses' on:2026-09 by:m",
        ]);
    });

    it('asks Jev for a text cased otherwise, or of a report not suggested now', async () => {
        const snapshot = await fixtureSnapshot();
        for (const prompt of [
            'expenses by month this year',
            'Banks today',
            'Expenses by month in 2025',
        ]) {
            const test = harness({ root: 'Expenses' });
            await createReport(snapshot, { prompt }, {}, test.options);
            expect(test.jevCalls).toBe(1);
        }
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
            "group:'Expenses' after:$y before:$m+1 by:m",
            "group:'Expenses' after:$y-1 before:$m-11 by:m",
        ]);
    });

    it('reads the last year with movements when this year has none, after one more query', async () => {
        const test = harness({ root: 'Expenses' }, LATER);
        const result = await createReport(await later(), { prompt: 'expenses' }, {}, test.options);
        expect(test.queries).toEqual([
            "group:'Expenses' after:$y before:$m+1 by:m",
            "group:'Expenses' after:$y-1 before:$m-11 by:m",
            // The one query of the root's history, to find its last movements.
            "group:'Expenses' before:$m+1 by:m",
            "group:'Expenses' on:2026 by:m",
            "group:'Expenses' on:2025 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', '2026'));
        // The report of that year, every amount Bkper's.
        const byIntent = await createReport(
            await later(),
            { intent: intent('g-expenses', '2026') },
            {},
            harness(undefined, LATER).options
        );
        expect(result.spec).toEqual(byIntent.spec);
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '3250.75' } });
    });

    it('reads a trend of the last year with movements when the last 12 months have none', async () => {
        const test = harness({ root: 'Expenses', over_time: 0.99 }, LATER);
        const result = await createReport(
            await later(),
            { prompt: 'expenses over time' },
            {},
            test.options
        );
        expect(test.queries.slice(2)).toEqual([
            "group:'Expenses' before:$m+1 by:m",
            "group:'Expenses' on:2026 by:m",
            "group:'Expenses' on:2025 by:m",
        ]);
        expect(result.intent).toEqual(
            intent('g-expenses', '2026', { monthly: true, view: 'trend' })
        );
    });

    it('reads a name from its group’s history, as its report reads it', async () => {
        const test = harness({ root: 'Revenue' }, LATER);
        const result = await createReport(await later(), { prompt: 'food' }, {}, test.options);
        expect(test.queries[2]).toBe("group:'Expenses' before:$m+1 by:m");
        expect(result.intent).toEqual(intent('g-expenses', '2026', { target: 'a-food' }));
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '250.75' } });
    });

    it('keeps the default period when the history has no movements either', async () => {
        const test = harness({ root: 'Expenses' }, LATER);
        const result = await createReport(
            await later(),
            { prompt: 'expenses #nothing' },
            {},
            test.options
        );
        expect(test.queries).toEqual([
            "group:'Expenses' #nothing after:$y before:$m+1 by:m",
            "group:'Expenses' #nothing after:$y-1 before:$m-11 by:m",
            "group:'Expenses' #nothing before:$m+1 by:m",
        ]);
        expect(result.intent).toEqual(intent('g-expenses', 'this_year', { hashtags: ['nothing'] }));
    });

    it('suggests reports of the last year with movements when the request is not one', async () => {
        const test = harness({ root: 'none', language: 'en' }, LATER);
        const error = await createReport(
            await later(),
            { prompt: 'what is the weather' },
            {},
            test.options
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotAReportError);
        expect((error as NotAReportError).suggestions).toEqual([
            'Net income in 2026',
            'Assets today',
            'Expenses by month in 2026',
        ]);
    });

    it('reads a position today, whenever it last moved, with no other query', async () => {
        const test = harness({ root: 'Assets' }, LATER);
        const result = await createReport(await later(), { prompt: 'assets' }, {}, test.options);
        expect(result.intent).toEqual(intent('g-assets', 'today'));
        expect(test.queries).toHaveLength(2);
    });

    it('keeps a period the request names, with movements or not', async () => {
        const named = harness({ root: 'Expenses', period: '2027' }, LATER);
        const result = await createReport(
            await later(),
            { prompt: 'expenses in 2027' },
            {},
            named.options
        );
        expect(result.intent).toEqual(intent('g-expenses', '2027'));
        expect(named.queries).toHaveLength(2);

        // An intent always names its period, as a suggestion's does.
        const byIntent = harness(undefined, LATER);
        const suggested = await createReport(
            await later(),
            { intent: intent('g-expenses', 'this_year', { monthly: true }) },
            {},
            byIntent.options
        );
        expect(suggested.intent.period).toEqual(p('this_year'));
        expect(byIntent.queries).toHaveLength(2);
    });
});

describe('the history of a request that names no period', () => {
    it('reads one root only, the first subject’s, even for a net result Report calculates', async () => {
        const ledger = simpleRootsLedger();
        ledger.today = '2028-03-10';
        const snapshot = await ledgerSnapshot(ledger);
        const queries: string[] = [];
        const options: ReportServiceOptions = {
            ...harness({ root: 'net-result' }).options,
            loadBalances: async asked => {
                queries.push(...asked);
                return asked.map(query => ledgerBalances(ledger, query, NOW));
            },
        };
        const result = await createReport(snapshot, { prompt: 'profit' }, {}, options);
        // The history reads from the start of the Book.
        expect(
            queries.filter(query => / before:\$m\+1 by:m$/.test(query) && !query.includes('after:'))
        ).toEqual(["group:'Expenses' before:$m+1 by:m"]);
        expect(result.intent).toEqual(intent('net-result', '2026'));
    });
});
