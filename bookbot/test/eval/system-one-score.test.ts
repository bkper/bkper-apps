import { describe, expect, it } from 'bun:test';

import type { DiscoveryCase, SyntheticBook } from '../../eval/system-one/cases.js';
import { buildRequest } from '../../eval/system-one/request.js';
import { scoreCall, scoreRecording, summarize, type RecordedCall, type Recording } from '../../eval/system-one/score.js';

const BOOK: SyntheticBook = {
    name: 'Test Book',
    bankAccount: 'Checking',
    accounts: [
        { name: 'Checking', type: 'ASSET', group: 'Bank Accounts' },
        { name: 'Hosting', type: 'OUTGOING', group: 'Expenses' },
        { name: 'Rent', type: 'OUTGOING', group: 'Expenses' },
    ],
};
const PRICING = { inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 10 };

function testCase(id: string, expected: string | null): DiscoveryCase {
    return { id, book: BOOK, direction: 'out', amount: 'USD 1.00', description: `SYNTHETIC ${id}`, expected, tags: expected ? ['clear'] : ['none_fits'] };
}

function call(discoveryCase: DiscoveryCase, choice: string, confidence: number, fits: number, latencyMs = 100): RecordedCall {
    return {
        caseId: discoveryCase.id,
        model: 'jev',
        status: 200,
        latencyMs,
        request: buildRequest('jev', discoveryCase),
        body: {
            model: 'jev-1',
            answers: {
                fits: { type: 'noul', noul: fits },
                account: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
            },
            usage: { input_tokens: 1000, output_tokens: 5 },
        },
    };
}

describe('System One discovery trial scoring', () => {
    it('reads the answers and prices the usage of a call', () => {
        const hosting = testCase('hosting', 'Hosting');

        expect(scoreCall(hosting, call(hosting, 'Hosting', 0.9, 0.8), PRICING)).toMatchObject({
            choice: 'Hosting', confidence: 0.9, fits: 0.8, costNanoUsd: 100_050,
        });
    });

    it('reports failed calls and answers outside the candidates as errors', () => {
        const hosting = testCase('hosting', 'Hosting');
        const failed = { ...call(hosting, 'Hosting', 0.9, 0.8), status: 400, body: { error: { type: 'invalid_request_error', code: 'unsupported_parameter', param: 'x', message: 'no' } } };

        expect(scoreCall(hosting, failed, PRICING).error).toBe('HTTP 400 unsupported_parameter');
        expect(scoreCall(hosting, call(hosting, 'Checking', 0.9, 0.8), PRICING).error).toBe('invalid_answer');
    });

    it('suggests only when an Account fits and counts wrong and missed suggestions', () => {
        const hosting = testCase('hosting', 'Hosting');
        const rent = testCase('rent', 'Rent');
        const none = testCase('none', null);
        const summary = summarize('jev', [
            scoreCall(hosting, call(hosting, 'Hosting', 0.95, 0.9), PRICING),
            scoreCall(rent, call(rent, 'Rent', 0.6, 0.3), PRICING),
            scoreCall(none, call(none, 'Rent', 0.8, 0.7), PRICING),
        ]);

        expect(summary.choiceAccuracy).toEqual({ hits: 2, total: 2 });
        expect(summary.decisionAccuracy).toEqual({ hits: 1, total: 3 });
        expect(summary.wrongSuggestions).toBe(1);
        expect(summary.missedSuggestions).toBe(1);
        expect(summary.byConfidence.find(row => row.threshold === 0.7)).toEqual({ threshold: 0.7, suggested: 2, correct: 1, coverage: { hits: 1, total: 2 } });
        expect(summary.byConfidenceGated.find(row => row.threshold === 0)).toEqual({ threshold: 0, suggested: 2, correct: 1, coverage: { hits: 1, total: 2 } });
    });

    it('refuses recordings whose requests no longer match the cases', () => {
        const hosting = testCase('hosting', 'Hosting');
        const recorded = call(hosting, 'Hosting', 0.9, 0.8);
        const recording: Recording = {
            recordedAt: '2026-11-07',
            endpoint: 'https://example.test/v1/systemone',
            release: '2026-11-07',
            pricing: { jev: PRICING },
            calls: [{ ...recorded, request: { ...recorded.request, state: 'changed' } }],
        };

        expect(() => scoreRecording([hosting], recording)).toThrow('Recorded request differs');
    });
});
