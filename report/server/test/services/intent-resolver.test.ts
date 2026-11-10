import { periodRequestOf, type PeriodParts } from 'report-shared/report-intent';
import { describe, expect, it } from 'vitest';
import { BkperAiError, createDecisionClient } from '../../src/services/decision-client';
import { THRESHOLDS, WHOLE, buildIntentRequest } from '../../src/services/intent-questions';
import { PERIOD_THRESHOLDS } from '../../src/services/period-questions';
import { ReportError } from '../../src/services/report';
import {
    SHOW_RULES,
    SHOW_RULE_NAMES,
    decideShown,
    extractHashtags,
    readIntent,
    resolveIntent,
    type IntentAnswers,
    type Judgments,
} from '../../src/services/intent-resolver';
import { findPromptNames } from '../../src/services/prompt-names';
import type { Snapshot } from '../../src/services/snapshot';
import { ServerTiming } from '../../src/services/timing';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

/** The parts of a period id, as intents now hold them. */
function p(id: string): PeriodParts {
    const request = periodRequestOf(id);
    if (!request) throw new Error(`Not a period id: ${id}`);
    return request.period;
}

const sure = (choice: string) => ({ choice, confidence: 0.99 });
const yes = { noul: 0.9 };
const no = { noul: 0.1 };

/** The period's answers of a request that names none. */
const UNNAMED = {
    span: sure('unspecified'),
    year: sure('unspecified'),
    month: sure('unspecified'),
    quarter: sure('unspecified'),
    compared_year: sure('unspecified'),
    compared_month: sure('unspecified'),
    compared_quarter: sure('unspecified'),
} satisfies Partial<IntentAnswers>;

/** The period's answers of a request for Q3 2026. */
const Q3_2026 = {
    ...UNNAMED,
    span: sure('quarter'),
    year: sure('2026'),
    quarter: sure('Q3'),
} satisfies Partial<IntentAnswers>;

/** The period's answers of a request for October 2026. */
const OCTOBER_2026 = {
    ...UNNAMED,
    span: sure('month'),
    year: sure('2026'),
    month: sure('October'),
} satisfies Partial<IntentAnswers>;

function answers(overrides: Partial<IntentAnswers> = {}): IntentAnswers {
    return {
        root: sure('Expenses'),
        target: sure(WHOLE),
        ...Q3_2026,
        over_time: no,
        composition: no,
        versus_earlier: no,
        year_earlier: no,
        bridge: no,
        chart_named: sure('none'),
        language: sure('pt'),
        ...overrides,
    };
}

/** The intent of `overrides`, which must be a report. */
async function intentOf(overrides: Partial<IntentAnswers>, snapshot?: Snapshot) {
    const result = await read(overrides, snapshot);
    if (!result.recognized) {
        throw new Error('Not a report');
    }
    return result.intent;
}

async function read(
    overrides: Partial<IntentAnswers> = {},
    snapshot?: Snapshot,
    tags: string[] = []
) {
    const book = snapshot ?? (await fixtureSnapshot());
    const { request: _, ...options } = buildIntentRequest('request', book);
    return readIntent(answers(overrides), options, book, tags);
}

/** The fixture read years later: its last movements, in November 2026, are then old. */
async function laterSnapshot(): Promise<Snapshot> {
    return { ...(await fixtureSnapshot()), today: '2028-03-10' };
}

describe('extractHashtags', () => {
    it('reads a hashtag without # and trailing punctuation', () => {
        expect(extractHashtags('despesas #ação_2026, por mês')).toEqual(['ação_2026']);
        expect(extractHashtags('despesas #a-b.')).toEqual(['a-b']);
    });

    it('reads only the first hashtag, as Bkper filters balances by exactly one', () => {
        expect(extractHashtags('despesas #viagem e #ação_2026, #viagem! #a-b.')).toEqual([
            'viagem',
        ]);
    });

    it('finds none in a plain request', () => {
        expect(extractHashtags('expenses # by month')).toEqual([]);
    });
});

const NONE: Judgments = {
    overTime: false,
    composition: false,
    versusEarlier: false,
    bridge: false,
};

describe('decideShown', () => {
    it('applies its rules in order, the first that applies deciding', () => {
        expect(SHOW_RULES.map(entry => entry.rule)).toEqual([...SHOW_RULE_NAMES]);
        const unnamed: Judgments = {
            overTime: true,
            composition: true,
            versusEarlier: true,
            bridge: true,
        };
        expect(decideShown({ ...unnamed, chartNamed: 'pie' })).toEqual({
            rule: 'named',
            chart: 'donut',
        });
        expect(decideShown(unnamed)).toEqual({ rule: 'bridge', chart: 'waterfall' });
        expect(decideShown({ ...unnamed, bridge: false })).toEqual({
            rule: 'versus_earlier',
            chart: 'compare',
        });
        const overTime = { ...NONE, overTime: true };
        expect(decideShown({ ...overTime, composition: true })).toEqual({
            rule: 'over_time_composition',
            chart: 'stacked',
        });
        expect(decideShown(overTime)).toEqual({ rule: 'over_time', view: 'trend' });
        expect(decideShown({ ...NONE, composition: true })).toEqual({
            rule: 'composition',
            view: 'breakdown',
        });
        expect(decideShown(NONE)).toEqual({ rule: 'auto' });
    });

    it('prefers the chart each chart word names', () => {
        const named = (chartNamed: Judgments['chartNamed'], more: Partial<Judgments> = {}) =>
            decideShown({ ...NONE, ...more, chartNamed }).chart;
        for (const word of ['line', 'area', 'stacked', 'waterfall', 'table'] as const) {
            expect(named(word)).toBe(word);
        }
        // A pie is drawn as a donut, the one round chart.
        expect(named('pie')).toBe('donut');
        // Bars of the months, of a period against an earlier one, or of the parts.
        expect(named('bars', { overTime: true, versusEarlier: true })).toBe('bar');
        expect(named('bars', { versusEarlier: true })).toBe('compare');
        expect(named('bars', { composition: true })).toBe('ranked-bar');
    });
});

describe('readIntent', () => {
    it('reads a confident answer as an intent with the root id', async () => {
        expect(await read()).toEqual({
            recognized: true,
            intent: { root: 'g-expenses', period: p('2026-Q3'), monthly: false },
            language: 'pt',
            trace: expect.objectContaining({ rule: 'auto' }),
        });
    });

    it('reads the net result, change over time and hashtags', async () => {
        const book = await fixtureSnapshot();
        const { request: _, ...options } = buildIntentRequest('request', book);
        const result = readIntent(
            answers({ root: sure('net-result'), over_time: { noul: THRESHOLDS.over_time } }),
            options,
            book,
            ['travel']
        );
        expect(result).toMatchObject({
            recognized: true,
            intent: {
                root: 'net-result',
                period: p('2026-Q3'),
                monthly: true,
                view: 'trend',
                hashtags: ['travel'],
            },
            language: 'pt',
        });
    });

    it('traces every judgment, with its answer and score, and the rule that fired', async () => {
        const result = await read({
            over_time: { noul: 0.7 },
            composition: { noul: 0.6 },
            chart_named: { choice: 'pie', confidence: THRESHOLDS.chart_named - 0.01 },
        });
        expect(result).toMatchObject({
            trace: {
                judgments: {
                    root: { answer: 'Expenses', score: 0.99 },
                    target: { answer: 'whole', score: 0.99 },
                    period: { answer: 'quarter', score: 0.99, read: 'quarter' },
                    year: { answer: '2026', score: 0.99, read: 2026 },
                    month: { answer: 'unspecified', score: 0.99 },
                    quarter: { answer: 'Q3', score: 0.99, read: 3 },
                    compared_year: { answer: 'unspecified', score: 0.99 },
                    over_time: { answer: true, score: 0.7 },
                    composition: { answer: true, score: 0.6 },
                    versus_earlier: { answer: false, score: 0.1 },
                    year_earlier: { answer: false, score: 0.1 },
                    bridge: { answer: false, score: 0.1 },
                    chart_named: { answer: 'pie', score: THRESHOLDS.chart_named - 0.01 },
                    language: { answer: 'pt', score: 0.99 },
                },
                rule: 'over_time_composition',
                targetRule: 'root',
            },
            intent: { chart: 'stacked', monthly: true },
        });
    });

    it('reads a sure chart word, and leaves an unsure one or none to the other rules', async () => {
        expect(await intentOf({ chart_named: sure('pie') })).toMatchObject({ chart: 'donut' });
        expect(await intentOf({ chart_named: sure('table') })).toMatchObject({ chart: 'table' });
        const unsure = await intentOf({
            chart_named: { choice: 'pie', confidence: THRESHOLDS.chart_named - 0.01 },
        });
        expect(unsure).not.toHaveProperty('chart');
        expect(await intentOf({})).not.toHaveProperty('chart');
        expect(await intentOf({ chart_named: sure('unknown') })).not.toHaveProperty('chart');
    });

    it('reads each judgment from its threshold', async () => {
        const at = (question: keyof typeof THRESHOLDS) => ({ noul: THRESHOLDS[question] });
        const below = (question: keyof typeof THRESHOLDS) => ({
            noul: THRESHOLDS[question] - 0.01,
        });
        expect(await intentOf({ bridge: at('bridge') })).toMatchObject({ chart: 'waterfall' });
        expect(await intentOf({ bridge: below('bridge') })).not.toHaveProperty('chart');
        expect(await intentOf({ versus_earlier: at('versus_earlier') })).toMatchObject({
            chart: 'compare',
        });
        expect(await intentOf({ composition: at('composition') })).toMatchObject({
            view: 'breakdown',
        });
        expect(await intentOf({ composition: below('composition') })).not.toHaveProperty('view');
        expect(await intentOf({ over_time: below('over_time') })).toMatchObject({
            monthly: false,
        });
    });

    it('compares with the same period a year earlier when the request asks so', async () => {
        const at = { noul: PERIOD_THRESHOLDS.year_earlier };
        const below = { noul: PERIOD_THRESHOLDS.year_earlier - 0.01 };
        expect(await intentOf({ versus_earlier: yes, year_earlier: at })).toMatchObject({
            period: p('2026-Q3'),
            chart: 'compare',
            compareWith: 'year_earlier',
        });
        expect(await intentOf({ year_earlier: at })).toMatchObject({
            compareWith: 'year_earlier',
        });
        expect(await intentOf({ versus_earlier: yes, year_earlier: below })).not.toHaveProperty(
            'compareWith'
        );
        expect(await read({ year_earlier: at })).toMatchObject({
            trace: { judgments: { year_earlier: { answer: true, score: at.noul } } },
        });
        // With the default period too.
        expect(await read({ ...UNNAMED, year_earlier: at })).toMatchObject({
            intent: { period: p('this_year'), compareWith: 'year_earlier' },
            defaultPeriod: true,
        });
    });

    it('reads the period the parts say, and the one they compare it with', async () => {
        expect(
            await read({
                ...UNNAMED,
                span: sure('year'),
                year: sure('last_year'),
                compared_year: sure('2023'),
                year_earlier: yes,
            })
        ).toMatchObject({
            intent: { period: { span: 'year', year: 'previous' }, compared: { year: 2023 } },
            trace: {
                judgments: {
                    year: { answer: 'last_year', read: 'previous' },
                    compared_year: { answer: '2023', read: 2023 },
                },
            },
        });
        const compared = await intentOf({
            ...UNNAMED,
            year: sure('2016'),
            compared_year: sure('2014'),
        });
        expect(compared).toEqual({
            root: 'g-expenses',
            period: { year: 2016 },
            compared: { year: 2014 },
            monthly: false,
        });
        // A rule that changed the parts is traced.
        expect(
            await read({ ...UNNAMED, year: sure('2016'), compared_year: sure('last_year') })
        ).toMatchObject({
            intent: { period: { year: 2016 }, compared: { year: 2015 } },
            trace: { periodRules: ['previous_of_period'] },
        });
        expect(await read()).not.toHaveProperty('trace.periodRules');
    });

    it('answers that a period has not started for the next year, month or quarter', async () => {
        for (const next of [
            { span: sure('year'), year: sure('next_year') },
            { span: sure('month'), month: sure('next_month') },
            { span: sure('quarter'), quarter: sure('next_quarter') },
        ]) {
            const error = await read({ ...UNNAMED, ...next }).catch((e: unknown) => e);
            expect(error, JSON.stringify(next)).toBeInstanceOf(ReportError);
            expect(error).toMatchObject({ reason: 'future_period' });
        }
        // Not a report of the Book first.
        expect(
            await read({ ...UNNAMED, root: sure('none'), year: sure('next_year') })
        ).toMatchObject({ recognized: false });
    });

    it('shows the months over time, whichever rule chose the chart', async () => {
        expect(await intentOf({ over_time: yes, versus_earlier: yes })).toMatchObject({
            monthly: true,
            chart: 'compare',
        });
        expect(await intentOf({ over_time: yes, chart_named: sure('bars') })).toMatchObject({
            monthly: true,
            chart: 'bar',
        });
    });

    it('reads a trend period over time, or for a chart by month, when no period is named', async () => {
        const unnamed = UNNAMED;
        expect(await intentOf({ ...unnamed, over_time: yes })).toMatchObject({
            period: p('last_12_months'),
            monthly: true,
        });
        for (const word of ['stacked', 'area', 'line']) {
            expect(await intentOf({ ...unnamed, chart_named: sure(word) })).toMatchObject({
                period: p('last_12_months'),
                chart: word,
            });
        }
        expect(await intentOf({ ...unnamed, chart_named: sure('pie') })).toMatchObject({
            period: p('this_year'),
            chart: 'donut',
        });
        expect(await intentOf({ ...unnamed, chart_named: sure('bars') })).toMatchObject({
            period: p('this_year'),
            chart: 'ranked-bar',
        });
        expect(await intentOf({ ...unnamed, composition: yes })).toMatchObject({
            period: p('this_year'),
        });
    });

    it('is not a report for no root or an unsure root', async () => {
        expect(await read({ root: sure('none') })).toEqual({ recognized: false, language: 'pt' });
        expect(
            await read({ root: { choice: 'Expenses', confidence: THRESHOLDS.root - 0.01 } })
        ).toEqual({ recognized: false, language: 'pt' });
    });

    it('leaves out an unsure language', async () => {
        const result = await read({
            language: { choice: 'pt', confidence: THRESHOLDS.language - 0.01 },
        });
        expect(result).toEqual({
            recognized: true,
            intent: { root: 'g-expenses', period: p('2026-Q3'), monthly: false },
            trace: expect.anything(),
        });
    });

    it('reads this year for activity and today for a position when no period is named', async () => {
        const unnamed = UNNAMED;
        expect(await read(unnamed)).toMatchObject({
            intent: { period: p('this_year') },
            defaultPeriod: true,
        });
        expect(await read({ ...unnamed, root: sure('Assets') })).toMatchObject({
            intent: { period: p('today') },
        });
        expect(await read({ ...unnamed, root: sure('net-result') })).toMatchObject({
            intent: { period: p('this_year') },
        });
    });

    it('reads the default period for an unsure period', async () => {
        const unsure = PERIOD_THRESHOLDS.span - 0.01;
        const result = await read({
            ...UNNAMED,
            span: { choice: 'quarter', confidence: unsure },
            quarter: { choice: 'Q3', confidence: PERIOD_THRESHOLDS.quarter - 0.01 },
        });
        expect(result).toMatchObject({ intent: { period: p('this_year') }, defaultPeriod: true });
    });

    it('leaves moving a default period to the report, as the map holds no dates', async () => {
        // The report reads the last year with movements when this one has none.
        const later = await laterSnapshot();
        const unnamed = UNNAMED;
        expect(await read(unnamed, later)).toMatchObject({
            intent: { period: p('this_year') },
            defaultPeriod: true,
        });
        expect(await read({ ...unnamed, root: sure('net-result') }, later)).toMatchObject({
            intent: { period: p('this_year') },
        });
        expect(await read({ ...unnamed, root: sure('Assets') }, later)).toMatchObject({
            intent: { period: p('today') },
        });
    });

    it('reads a longer default period for a trend', async () => {
        const unnamed = UNNAMED;
        const overTime = { ...unnamed, over_time: yes };
        expect(await read(overTime)).toMatchObject({
            intent: { period: p('last_12_months'), monthly: true },
        });
        expect(
            await read({ ...overTime, root: sure('Assets') }, await laterSnapshot())
        ).toMatchObject({ intent: { period: p('last_12_months') }, defaultPeriod: true });
    });

    it('anchors a root without movements to this year or today', async () => {
        const unnamed = { ...UNNAMED, root: sure('Card') };
        expect(await read(unnamed, await laterSnapshot())).toMatchObject({
            intent: { period: p('today') },
        });
        expect(await read({ ...unnamed, over_time: yes }, await laterSnapshot())).toMatchObject({
            intent: { period: p('last_12_months') },
        });
    });
});

describe('readIntent with a group or account the request means', () => {
    const unsure = (choice: string) => ({ choice, confidence: THRESHOLDS.target - 0.1 });

    it('reads a sure target under the root Jev chose', async () => {
        expect(await read({ target: sure('Rent') })).toMatchObject({
            intent: { root: 'g-expenses', target: 'a-rent' },
            trace: { judgments: { target: { answer: 'Rent', score: 0.99 } }, targetRule: 'target' },
        });
        expect(await read({ root: sure('Assets'), target: sure('Banks') })).toMatchObject({
            intent: { root: 'g-assets', target: 'g-banks' },
        });
        // Rent is under both Expenses and Net income: the root chosen holds it.
        expect(await read({ root: sure('Net income'), target: sure('Rent') })).toMatchObject({
            intent: { root: 'g-net', target: 'a-rent' },
        });
    });

    it('reads the root alone for an unsure target, or the whole', async () => {
        for (const target of [unsure('Rent'), sure(WHOLE), sure('Unknown')]) {
            const result = await read({ target });
            expect(result).toMatchObject({
                intent: { root: 'g-expenses' },
                trace: { targetRule: 'root' },
            });
            expect(result.recognized && result.intent).not.toHaveProperty('target');
        }
    });

    it('reads a sure target under its own root when Jev finds no root, or is unsure', async () => {
        expect(await read({ root: sure('none'), target: sure('Rent') })).toMatchObject({
            recognized: true,
            intent: { root: 'g-expenses', target: 'a-rent' },
            trace: { targetRule: 'target_root' },
        });
        expect(
            await read({
                root: { choice: 'Net income', confidence: THRESHOLDS.root - 0.1 },
                target: sure('Rent'),
            })
        ).toMatchObject({ intent: { root: 'g-net', target: 'a-rent' } });
        expect(
            await read({
                root: { choice: 'Card', confidence: THRESHOLDS.root - 0.1 },
                target: sure('Salary'),
            })
        ).toMatchObject({ intent: { root: 'g-revenue', target: 'a-salary' } });
        // Unsure of both: no report.
        expect(await read({ root: sure('none'), target: unsure('Rent') })).toEqual({
            recognized: false,
            language: 'pt',
        });
    });

    it('reads the root a sure target is not under, alone', async () => {
        const result = await read({ root: sure('Revenue'), target: sure('Rent') });
        expect(result).toMatchObject({
            intent: { root: 'g-revenue' },
            trace: { targetRule: 'other_root' },
        });
        expect(result.recognized && result.intent).not.toHaveProperty('target');
    });

    it('keeps the net result whole', async () => {
        const result = await read({ root: sure('net-result'), target: sure('Rent') });
        expect(result).toMatchObject({
            intent: { root: 'net-result' },
            trace: { targetRule: 'net_result' },
        });
        expect(result.recognized && result.intent).not.toHaveProperty('target');
    });

    it('reads the default period of the target', async () => {
        const result = await read({ ...UNNAMED, root: sure('none'), target: sure('Banks') });
        expect(result).toMatchObject({ intent: { target: 'g-banks', period: p('today') } });
    });
});

describe('readIntent with names the request writes', () => {
    async function named(prompt: string, overrides: Partial<IntentAnswers> = {}, book?: Snapshot) {
        const snapshot = book ?? (await fixtureSnapshot());
        const { request: _, ...options } = buildIntentRequest(prompt, snapshot);
        const names = findPromptNames(prompt, snapshot);
        return readIntent(answers(overrides), options, snapshot, [], names);
    }

    it('reports what the request names, over the root Jev chose', async () => {
        expect(await named('food in 2026-Q3', { root: sure('Revenue') })).toMatchObject({
            recognized: true,
            intent: { root: 'g-expenses', target: 'a-food', period: p('2026-Q3'), monthly: false },
            trace: { names: ['Food'], judgments: { root: { answer: 'Revenue' } } },
        });
        expect(await named('banks', { root: sure('Assets') })).toMatchObject({
            intent: { root: 'g-assets', target: 'g-banks' },
        });
        expect(await named('owner', { root: sure('Card') })).toMatchObject({
            intent: { root: 'a-owner' },
        });
        const root = await named('Expenses', { root: sure('net-result') });
        expect(root).toMatchObject({ intent: { root: 'g-expenses' } });
        expect(root.recognized && root.intent).not.toHaveProperty('target');
    });

    it('is a report of the names even when Jev finds no root, or is unsure', async () => {
        expect(await named('food', { root: sure('none') })).toMatchObject({
            recognized: true,
            intent: { root: 'g-expenses', target: 'a-food' },
        });
        expect(
            await named('rent', { root: { choice: 'Revenue', confidence: THRESHOLDS.root - 0.1 } })
        ).toMatchObject({ recognized: true, intent: { target: 'a-rent' } });
    });

    it('shows several names side by side, in the order written', async () => {
        const result = await named('rent versus food, by month', { over_time: yes });
        expect(result).toMatchObject({
            intent: {
                root: 'g-expenses',
                target: 'a-rent',
                alongside: [{ root: 'g-expenses', target: 'a-food' }],
                monthly: true,
                view: 'trend',
            },
            trace: { names: ['Rent', 'Food'] },
        });
        expect(await named('Expenses and Revenue')).toMatchObject({
            intent: { root: 'g-expenses', alongside: [{ root: 'g-revenue' }] },
        });
    });

    it('reads no composition of names side by side, which make no whole', async () => {
        const both = { over_time: yes, composition: yes };
        const result = await named('rent and food by month', both);
        expect(result).toMatchObject({
            intent: { monthly: true, view: 'trend' },
            trace: { rule: 'over_time', judgments: { composition: { answer: true } } },
        });
        expect(result.recognized && result.intent).not.toHaveProperty('chart');
        // A name alone has its parts.
        expect(await named('expenses by month', both)).toMatchObject({
            intent: { chart: 'stacked' },
            trace: { rule: 'over_time_composition' },
        });
        // A chart the request names is still asked for, and the report says why it does not fit.
        expect(await named('rent and food as a pie', { chart_named: sure('pie') })).toMatchObject({
            intent: { chart: 'donut' },
        });
    });

    it('reads the default period of what the request names', async () => {
        const unnamed = { ...UNNAMED, root: sure('Expenses') };
        expect(await named('banks', unnamed)).toMatchObject({ intent: { period: p('today') } });
        expect(await named('cash and banks', unnamed)).toMatchObject({
            intent: { period: p('today') },
        });
        // Food last moved in November 2026: read years later, the report moves its period.
        const later = await laterSnapshot();
        expect(await named('food', unnamed, later)).toMatchObject({
            intent: { period: p('this_year') },
            defaultPeriod: true,
        });
        expect(await named('food by month', { ...unnamed, over_time: yes }, later)).toMatchObject({
            intent: { period: p('last_12_months'), monthly: true },
        });
        // An account in no group: this year, or today for a position.
        expect(await named('owner', unnamed)).toMatchObject({ intent: { period: p('today') } });
    });

    it('keeps Jev’s period and judgments', async () => {
        expect(await named('food', { ...OCTOBER_2026, chart_named: sure('pie') })).toMatchObject({
            intent: { target: 'a-food', period: p('2026-10'), chart: 'donut' },
        });
    });

    it('reports what the request writes over the target Jev chose', async () => {
        expect(await named('food', { target: sure('Rent') })).toMatchObject({
            intent: { root: 'g-expenses', target: 'a-food' },
            trace: { names: ['Food'], targetRule: 'written' },
        });
    });

    it('leaves the root to Jev when the request names nothing of the Book', async () => {
        const result = await named('what we spent on groceries', { root: sure('Expenses') });
        expect(result).toMatchObject({ intent: { root: 'g-expenses' } });
        expect(result.recognized && result.intent).not.toHaveProperty('target');
        expect(result.recognized && result.trace).not.toHaveProperty('names');
    });
});

function jevResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function answerBody() {
    const choice = (value: string) => ({
        type: 'choice',
        choice: value,
        confidence: 1,
        probabilities: { [value]: 1 },
    });
    return {
        model: 'jev-1.13.0',
        answers: {
            root: choice('Revenue'),
            target: choice('whole'),
            span: choice('month'),
            year: choice('2026'),
            month: choice('October'),
            quarter: choice('unspecified'),
            compared_year: choice('unspecified'),
            compared_month: choice('unspecified'),
            compared_quarter: choice('unspecified'),
            over_time: { type: 'noul', noul: 0.02 },
            composition: { type: 'noul', noul: 0.8 },
            versus_earlier: { type: 'noul', noul: 0.03 },
            year_earlier: { type: 'noul', noul: 0.02 },
            bridge: { type: 'noul', noul: 0.01 },
            chart_named: choice('none'),
            language: choice('en'),
        },
        usage: { input_tokens: 1000, output_tokens: 10 },
    };
}

describe('resolveIntent', () => {
    it('asks Jev once with the platform placeholder, and measures it as jev', async () => {
        const requests: { url: string; init?: RequestInit }[] = [];
        const client = createDecisionClient({
            fetch: async (url, init) => {
                requests.push({ url, init });
                return jevResponse(answerBody());
            },
        });
        const timing = new ServerTiming();
        const snapshot = await fixtureSnapshot();

        const result = await resolveIntent('revenue in October 2026 #extra', snapshot, {
            client,
            timing,
        });

        expect(result).toMatchObject({
            recognized: true,
            intent: {
                root: 'g-revenue',
                period: p('2026-10'),
                monthly: false,
                view: 'breakdown',
                hashtags: ['extra'],
            },
            language: 'en',
            trace: { rule: 'composition' },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe('https://ai.bkper.app/v1/systemone');
        const headers = new Headers(requests[0].init?.headers);
        expect(headers.get('authorization')).toBe('Bearer bkper-platform-outbound');
        const body = JSON.parse(String(requests[0].init?.body));
        expect(body).toEqual({
            model: 'jev',
            ...buildIntentRequest('revenue in October 2026 #extra', snapshot).request,
        });
        expect(timing.header()).toMatch(/^jev;dur=/);
    });

    it('reports the names the request writes, with the same single decision request', async () => {
        const requests: string[] = [];
        const client = createDecisionClient({
            fetch: async (_url, init) => {
                requests.push(String(init?.body));
                return jevResponse(answerBody());
            },
        });
        const snapshot = await fixtureSnapshot();
        const prompt = 'Food and Rent in October 2026 #extra';
        const result = await resolveIntent(prompt, snapshot, {
            client,
            timing: new ServerTiming(),
        });
        expect(result).toMatchObject({
            recognized: true,
            intent: {
                root: 'g-expenses',
                target: 'a-food',
                alongside: [{ root: 'g-expenses', target: 'a-rent' }],
                period: p('2026-10'),
                hashtags: ['extra'],
            },
            trace: { names: ['Food', 'Rent'] },
        });
        expect(requests).toHaveLength(1);
        expect(JSON.parse(requests[0])).toEqual({
            model: 'jev',
            ...buildIntentRequest(prompt, snapshot).request,
        });

        // Renamed since the request was saved: no name is found, and Jev's root is read.
        const renamed = await fixtureSnapshot();
        renamed.accounts['a-food'] = { ...renamed.accounts['a-food'], name: 'Groceries' };
        renamed.accounts['a-rent'] = { ...renamed.accounts['a-rent'], name: 'Housing' };
        const again = await resolveIntent(prompt, renamed, { client, timing: new ServerTiming() });
        expect(again).toMatchObject({ intent: { root: 'g-revenue' } });
        expect(again.recognized && again.intent).not.toHaveProperty('target');
    });

    it('keeps the code of Bkper AI errors, such as an exhausted allowance', async () => {
        const client = createDecisionClient({
            fetch: async () =>
                jevResponse(
                    {
                        error: {
                            message: 'Monthly allowance exhausted',
                            type: 'rate_limit',
                            param: null,
                            code: 'usage_limit_exceeded',
                        },
                    },
                    403
                ),
        });
        const error = await resolveIntent('revenue', await fixtureSnapshot(), {
            client,
            timing: new ServerTiming(),
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BkperAiError);
        expect(error).toMatchObject({ status: 403, code: 'usage_limit_exceeded' });
    });

    it('reports failures outside Bkper AI without their body', async () => {
        const client = createDecisionClient({
            fetch: async () => new Response('upstream text', { status: 400 }),
        });
        const error = await resolveIntent('revenue', await fixtureSnapshot(), {
            client,
            timing: new ServerTiming(),
        }).catch((e: unknown) => e);
        expect(error).toMatchObject({ status: 400, code: 'bkper_ai_error' });
        expect(String(error)).not.toContain('upstream text');
    });
});
