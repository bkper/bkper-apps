import { BalancesReport, Book } from 'bkper-js';
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
import { bookPayload, fixtureSnapshot } from '../fixtures/snapshot-book';

const NOW = new Date('2026-11-05T16:00:00Z');

interface JevAnswers {
    root: string;
    period?: string;
    monthly?: number;
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
            monthly: { type: 'noul', noul: answers.monthly ?? 0.01 },
            view: choice('unspecified'),
            language: choice(answers.language ?? 'en'),
        },
        usage: { input_tokens: 1000, output_tokens: 10 },
    };
}

/** Bkper balances by day: the Expenses' Food account on a few days. */
function expensesByDay(): bkper.Balances {
    const day = (date: string, period: string): bkper.Balance => {
        const [year, month, dayOfMonth] = date.split('-').map(Number);
        return { year, month, day: dayOfMonth, periodBalance: period, cumulativeBalance: '0' };
    };
    const balances = [day('2026-10-02', '-30'), day('2026-11-05', '-7.25')];
    return {
        periodicity: 'DAILY',
        groupBalances: [
            {
                name: 'Expenses',
                credit: false,
                permanent: false,
                balances,
                accountBalances: [{ name: 'Food', credit: false, permanent: false, balances }],
            },
        ],
    };
}

interface Harness {
    options: ReportServiceOptions & { timing: ServerTiming };
    jevCalls: number;
    queries: string[];
    /** Events in the order they started. */
    events: string[];
}

function harness(
    answers: JevAnswers | (() => Response) = { root: 'Expenses' },
    balances: bkper.Balances = expensesByDay()
): Harness {
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
            readBalances: async query => {
                state.queries.push(query);
                state.events.push('balances');
                return new BalancesReport(new Book(bookPayload), balances);
            },
            timing: new ServerTiming(),
            now: () => NOW,
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
        expect(test.queries).toEqual([]);
        expect(result.intent).toEqual(intent('g-expenses', '2026-10'));
        expect(result.language).toBe('pt');
        expect(result.query).toBe("group:'Expenses' after:2026-10-01 before:2026-11-01");
        expect(result.dataAt).toBe('2026-11-05T15:00:00.000Z');
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

    it('runs the one live query a hashtag intent needs', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-expenses', 'last_month', { hashtags: ['trip'] }) },
            {},
            test.options
        );

        expect(test.queries).toEqual([
            "(group:'Assets' OR group:'Card' OR group:'Expenses' OR group:'Revenue' OR group:'Net income') #trip before:2026-11-06 by:d",
        ]);
        expect(result.query).toBe("group:'Expenses' #trip after:2026-10-01 before:2026-11-01");
        expect(result.dataAt).toBe(NOW.toISOString());
        expect(test.options.timing.header()).toContain('balances;dur=');
    });

    it('reads periods the snapshot cannot answer, such as today, live', async () => {
        const test = harness();
        const result = await createReport(
            await fixtureSnapshot(),
            { intent: intent('g-expenses', 'today') },
            {},
            test.options
        );

        expect(test.queries).toEqual(["group:'Expenses' after:2026-11-04 before:2026-11-06 by:d"]);
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

    it('prefers the requested language over the detected one', async () => {
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'gastos en octubre' },
            { requested: 'fr' },
            harness({ root: 'Expenses', language: 'es' }).options
        );
        expect(result.language).toBe('fr');
    });

    it('starts the hashtag query while Jev is still answering', async () => {
        const test = harness({ root: 'Expenses', period: 'last_month' });
        const result = await createReport(
            await fixtureSnapshot(),
            { prompt: 'expenses last month #trip' },
            {},
            test.options
        );

        expect(test.events).toEqual(['balances', 'jev']);
        expect(test.queries).toHaveLength(1);
        expect(result.intent).toEqual(intent('g-expenses', 'last_month', { hashtags: ['trip'] }));
        expect(result.spec.elements.answer).toMatchObject({ props: { amount: '30' } });
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
