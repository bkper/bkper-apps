import { describe, expect, it } from 'bun:test';

import { CASES, type ExtractionCase } from '../../eval/system-one/cases.js';
import type { SystemOneResponse } from '../../eval/system-one/contract.js';
import { geminiPrompt, geminiRequestMatches, geminiSystemPrompt } from '../../eval/system-one/gemini.js';
import { buildClairicRequest, type DocumentContent } from '../../eval/system-one/request.js';
import {
    checkSpans,
    CLAIRIC,
    fieldOutcome,
    GEMINI,
    itemsAddUp,
    normalizeCurrency,
    readGemini,
    scoreCase,
    scoreRecording,
    summarize,
    type RecordedCall,
} from '../../eval/system-one/score.js';

const TEXT = 'Invoice A-1 from Café Sol, 2026-10-01. Bread 3.00, coffee 2.50, tax 0.50. Total R$ 6,00';
const CASE: ExtractionCase = {
    id: 'test-invoice',
    tags: ['pt', 'invoice'],
    text: TEXT,
    expected: {
        date: '2026-10-01',
        total: 6,
        currency: 'BRL',
        supplier: ['Cafe Sol'],
        documentNumber: ['A-1'],
        description: ['bread', 'coffee'],
        lineAmounts: [3, 2.5],
        charges: [0.5],
        discounts: [],
    },
};
const DOCUMENT: DocumentContent = { mimeType: 'text/plain', base64: Buffer.from(TEXT, 'utf8').toString('base64') };
const PRICING = { inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 10, cachedInputNanoUsdPerToken: 1 };

function value(type: 'text' | 'number' | 'date', answer: string | number | null, confidence = 0.9, pNull = 0.01, span?: [number, number]) {
    return { type, value: answer, p_null: pNull, confidence, ...(answer !== null ? { guess: answer } : {}), ...(span ? { span } : {}) };
}

function clairicBody(overrides: Record<string, unknown> = {}): SystemOneResponse {
    return {
        model: 'clairic',
        answers: {
            date: value('date', '2026-10-01'),
            total: value('number', 6, 0.99),
            currency: value('text', 'R$', 0.8, 0.1, [80, 82]),
            supplier: value('text', 'Café Sol', 0.95, 0.01, [17, 25]),
            document_number: value('text', 'A-1', 0.95, 0.01, [8, 11]),
            description: value('text', 'Bread', 0.6, 0.2, [39, 44]),
            line_amounts: { type: 'list', value: [3, 2.5], confidence: 0.9 },
            charges: { type: 'list', value: [0.5], confidence: 0.9 },
            discounts: { type: 'list', value: [], confidence: 0.9 },
            ...overrides,
        },
        usage: { input_tokens: 1000, output_tokens: 0 },
        truncated: false,
    };
}

function clairicCall(body: unknown, status = 200): RecordedCall {
    return { caseId: CASE.id, model: CLAIRIC, status, latencyMs: 100, request: buildClairicRequest(CLAIRIC, CASE, DOCUMENT), body };
}

function geminiCall(transaction: unknown, usage = { input_tokens: 500, output_tokens: 100, input_tokens_details: { cached_tokens: 100 } }): RecordedCall {
    return {
        caseId: CASE.id,
        model: GEMINI,
        status: 200,
        latencyMs: 2000,
        request: {},
        body: { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(transaction) }] }], usage },
    };
}

describe('extraction trial scoring', () => {
    it('itemizes every synthetic document consistently with its total', () => {
        const itemized = CASES.filter(extractionCase => extractionCase.expected.lineAmounts.length > 0);

        expect(itemized.length).toBeGreaterThan(0);
        for (const extractionCase of itemized) {
            expect({ id: extractionCase.id, addsUp: itemsAddUp(extractionCase.expected.total ?? 0, extractionCase.expected) })
                .toEqual({ id: extractionCase.id, addsUp: true });
        }
    });

    it('tells correct nulls from hallucinated and missed values', () => {
        const noDate = { ...CASE.expected, date: null };

        expect(fieldOutcome('date', { value: null }, noDate)).toBe('correct_null');
        expect(fieldOutcome('date', { value: '2026-10-01' }, noDate)).toBe('hallucinated');
        expect(fieldOutcome('date', { value: null }, CASE.expected)).toBe('missed');
        expect(fieldOutcome('date', { value: '2026-01-10' }, CASE.expected)).toBe('wrong');
        expect(fieldOutcome('supplier', { value: 'CAFÉ SOL LTDA' }, CASE.expected)).toBe('correct');
        expect(fieldOutcome('document_number', { value: 'a1' }, CASE.expected)).toBe('correct');
        expect(['No A-1', 'Nº A-1', '#A-1', 'NOA-1'].map(number => fieldOutcome('document_number', { value: number }, CASE.expected)))
            .toEqual(['correct', 'correct', 'correct', 'wrong']);
        expect(fieldOutcome('total', { value: 6.001 }, CASE.expected)).toBe('correct');
        expect(fieldOutcome('total', { value: 6.01 }, CASE.expected)).toBe('wrong');
    });

    it('normalizes currency symbols and names to ISO codes', () => {
        expect(['R$', ' reais', '$', 'US$', '€', '£', 'eur'].map(normalizeCurrency)).toEqual(['BRL', 'BRL', 'USD', 'USD', 'EUR', 'GBP', 'EUR']);
    });

    it('adds items, charges and discounts in cents', () => {
        expect(itemsAddUp(0.3, { lineAmounts: [0.1, 0.2], charges: [], discounts: [] })).toBe(true);
        expect(itemsAddUp(80.53, { lineAmounts: [34.99, 27.5, 16], charges: [5.99, 6.05], discounts: [10] })).toBe(true);
        expect(itemsAddUp(10, { lineAmounts: [], charges: [10], discounts: [] })).toBe(false);
    });

    it('checks spans in code points against the state, or the state text when returned', () => {
        const request = buildClairicRequest(CLAIRIC, CASE, DOCUMENT);
        const wrongSpan = clairicBody({ supplier: value('text', 'Café Sol', 0.95, 0.01, [16, 24]) });

        expect(checkSpans(clairicBody(), request, false)).toEqual({ textSpans: 4, textSpansMatching: 4, otherSpans: 0, otherSpansInBounds: 0, imageSpans: 0 });
        expect(checkSpans(wrongSpan, request, false).textSpansMatching).toBe(3);
        expect(checkSpans({ ...clairicBody(), state_text: `xx${TEXT}` }, request, false).textSpansMatching).toBe(0);
    });

    it('scores a Clairic answer, prices its usage and verifies its total from the items', () => {
        expect(scoreCase(CASE, DOCUMENT, [clairicCall(clairicBody())], PRICING)).toMatchObject({
            costNanoUsd: 100_000,
            lineItemsExact: true,
            totalVerified: true,
            totalCorrect: true,
            fields: { date: { outcome: 'correct', confidence: 0.9 }, description: { outcome: 'correct' } },
        });
        const nulled = clairicBody({ currency: { type: 'text', value: null, guess: 'R$', p_null: 0.9, confidence: 0.8 } });
        expect(scoreCase(CASE, DOCUMENT, [clairicCall(nulled)], PRICING).fields?.currency).toMatchObject({ outcome: 'missed', guessCorrect: true });
        const referenceDate = clairicBody({ date: value('date', '2026-10-31') });
        expect(scoreCase(CASE, DOCUMENT, [clairicCall(referenceDate)], PRICING).dateIsReference).toBe(true);
        const unbalanced = clairicBody({ charges: { type: 'list', value: [], confidence: 0.9 } });
        expect(scoreCase(CASE, DOCUMENT, [clairicCall(unbalanced)], PRICING).totalVerified).toBe(false);
    });

    it('reports failed calls and malformed answers as errors', () => {
        const rejected = { error: { type: 'invalid_request_error', code: 'unsupported_parameter', param: 'assets', message: 'no' } };

        expect(scoreCase(CASE, DOCUMENT, [clairicCall(rejected, 400)], PRICING).error).toBe('HTTP 400 unsupported_parameter');
        expect(scoreCase(CASE, DOCUMENT, [clairicCall(clairicBody({ total: value('text', '6') }))], PRICING).error).toBe('invalid_answer');
        expect(scoreCase(CASE, DOCUMENT, [geminiCall({ amount: 6 })], PRICING).error).toBe('invalid_answer');
    });

    it('reads the bot transaction, with amount 0 and absent properties as no value', () => {
        const extraction = readGemini({ date: null, description: 'Pão', amount: 0, properties: { document_number: 42, supplier: '' } });

        expect(extraction.fields).toEqual({
            date: { value: null },
            total: { value: null },
            currency: { value: null },
            supplier: { value: null },
            document_number: { value: '42' },
            description: { value: 'Pão' },
        });
    });

    it('sums retries into the cost and latency of a Gemini document', () => {
        const transaction = { date: '2026-10-01', description: 'Bread and coffee', amount: 6, properties: { supplier: 'Café Sol', currency: 'BRL' } };
        const failed: RecordedCall = { ...geminiCall(transaction), status: 503, body: { error: { code: 'provider_unavailable' } } };
        const outcome = scoreCase(CASE, DOCUMENT, [failed, geminiCall(transaction)], PRICING);

        expect(outcome).toMatchObject({ calls: 2, latencyMs: 4000, costNanoUsd: 400 * 100 + 100 * 1 + 100 * 10 });
        expect(outcome.fields?.document_number.outcome).toBe('missed');
        expect(outcome.totalVerified).toBeUndefined();
    });

    it('summarizes accuracy, null handling and confidence thresholds', () => {
        const noNumber: ExtractionCase = { ...CASE, id: 'no-number', expected: { ...CASE.expected, documentNumber: null } };
        const summary = summarize(CLAIRIC, [
            scoreCase(CASE, DOCUMENT, [clairicCall(clairicBody())], PRICING),
            scoreCase(noNumber, DOCUMENT, [{ ...clairicCall(clairicBody()), caseId: noNumber.id }], PRICING),
        ]);

        expect(summary.accuracy).toEqual({ hits: 11, total: 12 });
        expect(summary.byField.document_number).toMatchObject({ present: { hits: 1, total: 1 }, absent: { hits: 0, total: 1 }, hallucinated: 1 });
        expect(summary.byConfidence?.find(row => row.threshold === 0.9)).toEqual({ threshold: 0.9, kept: 8, correct: 7, coverage: { hits: 7, total: 11 } });
    });

    it('matches a recorded Gemini request only with the current prompts and document', () => {
        const request = (prompt: string, document: string) => ({
            model: GEMINI,
            instructions: geminiSystemPrompt(),
            input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_text', text: document }] }],
        });

        expect(geminiPrompt()).toContain('document_number: invoice, receipt, order or bill number');
        expect(geminiPrompt()).not.toContain('Do NOT include any additional property');
        expect(geminiRequestMatches(request(geminiPrompt(), TEXT), DOCUMENT)).toBe(true);
        expect(geminiRequestMatches(request(geminiPrompt(), 'another document'), DOCUMENT)).toBe(false);
        expect(geminiRequestMatches(request('another prompt', TEXT), DOCUMENT)).toBe(false);
    });

    it('refuses recordings whose requests no longer match the cases', () => {
        const stale = { ...clairicCall(clairicBody()), request: { ...buildClairicRequest(CLAIRIC, CASE, DOCUMENT), state: 'changed' } };
        const recording = { recordedAt: '2026-11-07', endpoints: {}, release: '2026-11-07', pricing: {}, calls: [stale] };

        expect(() => scoreRecording([CASE], new Map([[CASE.id, DOCUMENT]]), recording)).toThrow('Recorded request differs');
    });
});
