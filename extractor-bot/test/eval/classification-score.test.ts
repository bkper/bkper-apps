import { describe, expect, it } from 'bun:test';

import { CASES, LABELS, type ClassificationCase } from '../../eval/classification/cases.js';
import {
    callFlashLite,
    flashLiteModel,
    flashLiteRequestMatches,
    flashLiteSystemPrompt,
    readFlashLiteAnswer,
} from '../../eval/classification/flash-lite.js';
import {
    buildDecisionRequest,
    documentContent,
    FILE_PLACEHOLDER,
    KIND_CRITERIA,
    loadDocuments,
    redactDocument,
} from '../../eval/classification/request.js';
import {
    atThreshold,
    brierScore,
    DECISION,
    FLASH_LITE,
    renderReport,
    scoreCase,
    scoreRecording,
    tally,
    type CaseResult,
    type RecordedCall,
} from '../../eval/classification/score.js';

const PRICING = { inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 1000, cachedInputNanoUsdPerToken: 10 };
const PDF = documentContent('statement.pdf', Buffer.from('%PDF-1.4 synthetic statement'));
const PNG = documentContent('receipt.png', Buffer.from('synthetic png bytes'));
const STATEMENT: ClassificationCase = { id: 'statement', file: 'statement.pdf', format: 'pdf', label: 'statement', tags: ['en'] };

function flashLiteRequest(document = PDF): unknown {
    return {
        model: flashLiteModel(),
        instructions: flashLiteSystemPrompt(),
        input: [{ role: 'user', content: [{ type: 'input_file', file_data: `data:application/pdf;base64,sha256:${document.sha256}` }] }],
    };
}

function flashLiteBody(kind: string, usage = { input_tokens: 1000, output_tokens: 20 }): unknown {
    return {
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ kind }) }] }],
        usage: { ...usage, input_tokens_details: { cached_tokens: 100 } },
    };
}

function decisionBody(pStatement: number): unknown {
    return {
        model: DECISION,
        answers: {
            kind: {
                type: 'choice',
                choice: pStatement >= 0.5 ? 'statement' : 'single_transaction',
                confidence: Math.max(pStatement, 1 - pStatement),
                probabilities: { statement: pStatement, single_transaction: 1 - pStatement },
            },
        },
        usage: { input_tokens: 800, output_tokens: 0 },
    };
}

function call(model: string, status: number, body: unknown, request: unknown, latencyMs = 100): RecordedCall {
    return { caseId: STATEMENT.id, model, status, latencyMs, request, body };
}

function decisionRequest(document = PDF): unknown {
    return redactDocument(buildDecisionRequest(document), document);
}

function result(label: CaseResult['label'], pStatement?: number, error?: string): CaseResult {
    return {
        caseId: 'case', model: DECISION, label, format: 'pdf', calls: 1, latencyMs: 1, costNanoUsd: 0,
        ...(error ? { error } : { pStatement, predicted: (pStatement ?? 0) >= 0.5 ? 'statement' : 'single_transaction' }),
    };
}

describe('classification trial cases', () => {
    it('loads every document with the media type the bot sends', async () => {
        const documents = await loadDocuments(CASES);
        for (const classificationCase of CASES) {
            const document = documents.get(classificationCase.id);
            expect(document?.base64.length).toBeGreaterThan(0);
            const expected = classificationCase.format === 'image'
                ? (classificationCase.file.endsWith('.png') ? 'image/png' : 'image/jpeg')
                : 'application/pdf';
            expect(document?.mediaType).toBe(expected);
        }
        expect(new Set(CASES.map(classificationCase => classificationCase.id)).size).toBe(CASES.length);
        expect(new Set(CASES.map(classificationCase => classificationCase.label))).toEqual(new Set(LABELS));
    });

    it('keeps every decision request within the gateway body limit', async () => {
        const documents = await loadDocuments(CASES);
        for (const document of documents.values()) {
            expect(JSON.stringify(buildDecisionRequest(document)).length).toBeLessThan(32 * 1024 * 1024);
        }
    });
});

describe('decision request', () => {
    it('sends a PDF as a file asset and an image as an image asset, named in the state', () => {
        expect(buildDecisionRequest(PDF).assets[FILE_PLACEHOLDER]).toEqual({ type: 'file', media_type: 'application/pdf', data_base64: PDF.base64 });
        expect(buildDecisionRequest(PNG).assets[FILE_PLACEHOLDER]).toEqual({ type: 'image', format: 'png', data_base64: PNG.base64 });
        expect(buildDecisionRequest(PDF).state.document).toBe(FILE_PLACEHOLDER);
    });

    it('asks one choice between exactly the bot labels', () => {
        const questions = Object.values(buildDecisionRequest(PDF).questions);
        expect(questions).toHaveLength(1);
        expect(Object.keys(questions[0].criteria).sort()).toEqual([...LABELS].sort());
        expect(questions[0].criteria).toEqual(KIND_CRITERIA);
    });

    it('records the request without the document bytes', () => {
        const recorded = JSON.stringify(decisionRequest());
        expect(recorded).not.toContain(PDF.base64);
        expect(recorded).toContain(`sha256:${PDF.sha256}`);
    });
});

describe('Flash-Lite recording', () => {
    it('records the bot request without the document bytes, and matches it to the document', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = Object.assign(async () => new Response(JSON.stringify({
            id: 'resp_test', object: 'response', created_at: 0, status: 'completed', model: flashLiteModel(),
            output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed',
                content: [{ type: 'output_text', text: '{"kind":"statement"}', annotations: [] }] }],
            usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }), { preconnect: realFetch.preconnect });
        try {
            const exchanges = await callFlashLite('https://ai.test/v1', 'token', PDF, () => undefined);
            expect(exchanges).toHaveLength(1);
            expect(JSON.stringify(exchanges[0].request)).not.toContain(PDF.base64);
            expect(flashLiteRequestMatches(exchanges[0].request, PDF)).toBe(true);
            expect(flashLiteRequestMatches(exchanges[0].request, PNG)).toBe(false);
            expect(readFlashLiteAnswer(exchanges[0].body)).toEqual({ kind: 'statement' });
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});

describe('scoring', () => {
    it('reads Flash-Lite answers as the bot routes them and adds up retries', () => {
        const scored = scoreCase(STATEMENT, PDF, FLASH_LITE, [
            call(FLASH_LITE, 503, { error: { code: 'upstream_error' } }, flashLiteRequest(), 50),
            call(FLASH_LITE, 200, flashLiteBody('statement'), flashLiteRequest(), 150),
        ], PRICING);
        expect(scored).toMatchObject({ predicted: 'statement', calls: 2, latencyMs: 200 });
        expect(scored.costNanoUsd).toBe(900 * 100 + 100 * 10 + 20 * 1000);
        expect(readFlashLiteAnswer(flashLiteBody('something_else'))).toBeUndefined();
    });

    it('counts a failed Flash-Lite classification as an error, as the bot fails the parse', () => {
        const scored = scoreCase(STATEMENT, PDF, FLASH_LITE, [call(FLASH_LITE, 500, { error: { code: 'internal' } }, flashLiteRequest())], PRICING);
        expect(scored.error).toBe('HTTP 500 internal');
        expect(scored.predicted).toBeUndefined();
    });

    it('reads the decision probability of statement and names a rejected asset', () => {
        const answered = scoreCase(STATEMENT, PDF, DECISION, [call(DECISION, 200, decisionBody(0.82), decisionRequest())], PRICING);
        expect(answered).toMatchObject({ pStatement: 0.82, predicted: 'statement', costNanoUsd: 800 * 100 });

        const rejected = scoreCase(STATEMENT, PDF, DECISION, [call(DECISION, 400, {
            error: { type: 'invalid_request_error', code: 'unsupported_parameter', param: 'assets.uploaded-file.media_type', message: 'No PDFs.' },
        }, decisionRequest())], PRICING);
        expect(rejected.error).toBe('HTTP 400 unsupported_parameter (assets.uploaded-file.media_type)');
    });

    it('refuses recordings made for another document or prompt', () => {
        const other = documentContent('other.pdf', Buffer.from('%PDF-1.4 other'));
        expect(() => scoreCase(STATEMENT, PDF, DECISION, [call(DECISION, 200, decisionBody(0.9), decisionRequest(other))], PRICING)).toThrow('record again');
        expect(() => scoreCase(STATEMENT, PDF, FLASH_LITE, [call(FLASH_LITE, 200, flashLiteBody('statement'), flashLiteRequest(other))], PRICING)).toThrow('record again');
        expect(() => scoreCase(STATEMENT, PDF, FLASH_LITE, [], PRICING)).toThrow('No recorded');
    });

    it('moves documents from statement to single as the threshold rises, and errors are never correct', () => {
        const results = [result('statement', 0.95), result('statement', 0.75), result('single_transaction', 0.6), result('single_transaction', 0.1), result('statement', undefined, 'HTTP 400')];
        expect(tally(results)).toMatchObject({ correct: 3, statementsCaught: 2, statements: 3, singlesAsStatements: 1, singles: 2, errors: 1 });
        expect(tally(results, atThreshold(0.7))).toMatchObject({ correct: 4, statementsCaught: 2, singlesAsStatements: 0 });
        expect(tally(results, atThreshold(0.9))).toMatchObject({ correct: 3, statementsCaught: 1, singlesAsStatements: 0 });
        expect(brierScore(results)).toBeCloseTo((0.05 ** 2 + 0.25 ** 2 + 0.6 ** 2 + 0.1 ** 2) / 4, 10);
    });

    it('scores and renders a full recording', async () => {
        const documents = await loadDocuments(CASES);
        const calls = CASES.flatMap(classificationCase => {
            const document = documents.get(classificationCase.id);
            if (!document) throw new Error(`No document for ${classificationCase.id}.`);
            const isStatement = classificationCase.label === 'statement';
            return [
                { ...call(FLASH_LITE, 200, flashLiteBody(isStatement ? 'statement' : 'single_transaction'), flashLiteRequest(document)), caseId: classificationCase.id },
                { ...call(DECISION, 200, decisionBody(isStatement ? 0.9 : 0.2), decisionRequest(document)), caseId: classificationCase.id },
            ];
        });
        const results = scoreRecording(CASES, documents, {
            recordedAt: {}, endpoints: {}, release: 'test', pricing: { [FLASH_LITE]: PRICING, [DECISION]: PRICING }, calls,
        });
        expect(results).toHaveLength(CASES.length * 2);
        expect(tally(results.filter(scored => scored.model === DECISION)).correct).toBe(CASES.length);
        const report = renderReport(results);
        expect(report).toContain(`${CASES.length}/${CASES.length} (100.0%)`);
        expect(report).toContain('### Decision thresholds');
    });
});
