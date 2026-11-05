import { describe, expect, it } from 'vitest';
import { BkperAiError, createDecisionClient } from '../../src/services/decision-client';
import { THRESHOLDS, buildIntentRequest } from '../../src/services/intent-questions';
import {
    extractHashtags,
    readIntent,
    resolveIntent,
    type IntentAnswers,
} from '../../src/services/intent-resolver';
import type { Snapshot } from '../../src/services/snapshot';
import { ServerTiming } from '../../src/services/timing';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

const sure = (choice: string) => ({ choice, confidence: 0.99 });

function answers(overrides: Partial<IntentAnswers> = {}): IntentAnswers {
    return {
        root: sure('Expenses'),
        period: sure('2026-Q3'),
        monthly: { noul: 0.1 },
        view: sure('unspecified'),
        language: sure('pt'),
        ...overrides,
    };
}

async function read(
    overrides: Partial<IntentAnswers> = {},
    snapshot?: Snapshot,
    tags: string[] = []
) {
    const book = snapshot ?? (await fixtureSnapshot());
    const { roots } = buildIntentRequest('request', book);
    return readIntent(answers(overrides), roots, book, tags);
}

/** The fixture read years later: its last movements, in November 2026, are then old. */
async function laterSnapshot(): Promise<Snapshot> {
    return { ...(await fixtureSnapshot()), today: '2028-03-10' };
}

describe('extractHashtags', () => {
    it('reads each hashtag once, without # and trailing punctuation', () => {
        expect(extractHashtags('despesas #viagem e #ação_2026, #viagem! #a-b.')).toEqual([
            'viagem',
            'ação_2026',
            'a-b',
        ]);
    });

    it('finds none in a plain request and caps how many it reads', () => {
        expect(extractHashtags('expenses # by month')).toEqual([]);
        const many = Array.from({ length: 12 }, (_, i) => `#t${i}`).join(' ');
        expect(extractHashtags(many)).toHaveLength(10);
    });
});

describe('readIntent', () => {
    it('reads a confident answer as an intent with the root id', async () => {
        expect(await read()).toEqual({
            recognized: true,
            intent: { root: 'g-expenses', period: '2026-Q3', monthly: false },
            language: 'pt',
        });
    });

    it('reads the net result, months, the view and hashtags', async () => {
        const book = await fixtureSnapshot();
        const { roots } = buildIntentRequest('request', book);
        const result = readIntent(
            answers({
                root: sure('net-result'),
                monthly: { noul: THRESHOLDS.monthly },
                view: sure('trend'),
            }),
            roots,
            book,
            ['travel']
        );
        expect(result).toEqual({
            recognized: true,
            intent: {
                root: 'net-result',
                period: '2026-Q3',
                monthly: true,
                view: 'trend',
                hashtags: ['travel'],
            },
            language: 'pt',
        });
    });

    it('is not a report for no root or an unsure root', async () => {
        expect(await read({ root: sure('none') })).toEqual({ recognized: false, language: 'pt' });
        expect(
            await read({ root: { choice: 'Expenses', confidence: THRESHOLDS.root - 0.01 } })
        ).toEqual({ recognized: false, language: 'pt' });
    });

    it('leaves out an unsure language and an unsure view', async () => {
        const result = await read({
            language: { choice: 'pt', confidence: THRESHOLDS.language - 0.01 },
            view: { choice: 'total', confidence: THRESHOLDS.view - 0.01 },
        });
        expect(result).toEqual({
            recognized: true,
            intent: { root: 'g-expenses', period: '2026-Q3', monthly: false },
        });
    });

    it('reads this year for activity and today for a position when no period is named', async () => {
        const unnamed = { period: sure('unspecified') };
        expect(await read(unnamed)).toMatchObject({ intent: { period: 'this_year' } });
        expect(await read({ ...unnamed, root: sure('Assets') })).toMatchObject({
            intent: { period: 'today' },
        });
        expect(await read({ ...unnamed, root: sure('net-result') })).toMatchObject({
            intent: { period: 'this_year' },
        });
    });

    it('reads the default period for an unsure period', async () => {
        const result = await read({
            period: { choice: '2026-Q3', confidence: THRESHOLDS.period - 0.01 },
        });
        expect(result).toMatchObject({ intent: { period: 'this_year' } });
    });

    it('anchors the default period to the last year with movements', async () => {
        const later = await laterSnapshot();
        const unnamed = { period: sure('unspecified') };
        expect(await read(unnamed, later)).toMatchObject({ intent: { period: '2026' } });
        expect(await read({ ...unnamed, root: sure('net-result') }, later)).toMatchObject({
            intent: { period: '2026' },
        });
        expect(await read({ ...unnamed, root: sure('Assets') }, later)).toMatchObject({
            intent: { period: 'today' },
        });
    });

    it('reads a longer default period for a trend', async () => {
        const unnamed = { period: sure('unspecified') };
        const monthly = { ...unnamed, monthly: { noul: 0.9 } };
        expect(await read(monthly)).toMatchObject({
            intent: { period: 'last_12_months', monthly: true },
        });
        expect(await read({ ...unnamed, view: sure('trend') })).toMatchObject({
            intent: { period: 'last_12_months', view: 'trend' },
        });
        expect(
            await read({ ...monthly, root: sure('Assets') }, await laterSnapshot())
        ).toMatchObject({ intent: { period: '2026' } });
    });

    it('anchors a root without movements to this year or today', async () => {
        const unnamed = { period: sure('unspecified'), root: sure('Card') };
        expect(await read(unnamed, await laterSnapshot())).toMatchObject({
            intent: { period: 'today' },
        });
        expect(
            await read({ ...unnamed, monthly: { noul: 0.9 } }, await laterSnapshot())
        ).toMatchObject({ intent: { period: 'last_12_months' } });
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
            period: choice('2026-10'),
            monthly: { type: 'noul', noul: 0.02 },
            view: choice('total'),
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

        expect(result).toEqual({
            recognized: true,
            intent: {
                root: 'g-revenue',
                period: '2026-10',
                monthly: false,
                view: 'total',
                hashtags: ['extra'],
            },
            language: 'en',
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
