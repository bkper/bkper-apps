import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { Book, File } from 'bkper-js';

import { BkperAIClientError } from '../../../src/genai/BkperAIClientError.js';
import { BkperAIEvaluationsClient } from '../../../src/genai/BkperAIEvaluationsClient.js';
import {
    ExtractorFileClassification,
    STATEMENT_PROBABILITY_THRESHOLD,
} from '../../../src/genai/file/ExtractorFileClassification.js';

function file(contentType: string | undefined, content: string | undefined): File {
    return new File(new Book({ id: 'book_1' }), { name: 'upload', contentType, content });
}

function choiceResponse(pStatement: number): Response {
    return Response.json({
        model: 'gemini-decision',
        answers: {
            kind: {
                type: 'choice',
                choice: pStatement >= 0.5 ? 'statement' : 'single_transaction',
                confidence: Math.max(pStatement, 1 - pStatement),
                probabilities: { statement: pStatement, single_transaction: 1 - pStatement },
            },
        },
        usage: { input_tokens: 300, output_tokens: 0 },
    });
}

function classifier(document: File, respond: () => Response, requests: Request[] = []): ExtractorFileClassification {
    const client = new BkperAIEvaluationsClient({
        baseUrl: 'https://ai.bkper.app/v1',
        oauthToken: 'oauth-secret',
        fetch: Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push(new Request(input, init));
            return respond();
        }, { preconnect: fetch.preconnect }),
    });
    return new ExtractorFileClassification(document, client);
}

async function sentBody(document: File): Promise<Record<string, unknown>> {
    const requests: Request[] = [];
    await classifier(document, () => choiceResponse(0.1), requests).extract();
    expect(requests).toHaveLength(1);
    return await requests[0].json() as Record<string, unknown>;
}

describe('ExtractorFileClassification', () => {
    afterEach(() => spyOn(console, 'log').mockRestore());

    it('asks Gemini Decision to choose between statement and single transaction, with the file as an asset', async () => {
        spyOn(console, 'log').mockImplementation(() => undefined);
        const body = await sentBody(file('application/pdf', 'JVBERi0xLjQK'));

        expect(body.model).toBe('gemini-decision');
        expect(body.state).toEqual({ document: 'uploaded-file' });
        expect(body.assets).toEqual({ 'uploaded-file': { type: 'file', media_type: 'application/pdf', data_base64: 'JVBERi0xLjQK' } });
        expect(body.questions).toEqual({
            kind: {
                type: 'choice',
                instructions: 'Classify `document` for transaction extraction.',
                criteria: {
                    statement: expect.stringContaining('bank statement'),
                    single_transaction: expect.stringContaining('invoice'),
                },
            },
        });
    });

    it('sends png, jpeg and webp as images, and normalizes the content type', async () => {
        spyOn(console, 'log').mockImplementation(() => undefined);
        expect((await sentBody(file('image/png', 'iVBORw0K'))).assets).toEqual({ 'uploaded-file': { type: 'image', format: 'png', data_base64: 'iVBORw0K' } });
        expect((await sentBody(file('image/jpg', '/9j/4AAQ'))).assets).toEqual({ 'uploaded-file': { type: 'image', format: 'jpeg', data_base64: '/9j/4AAQ' } });
        expect((await sentBody(file('Application/PDF; charset=binary', 'JVBERi0xLjQK'))).assets)
            .toEqual({ 'uploaded-file': { type: 'file', media_type: 'application/pdf', data_base64: 'JVBERi0xLjQK' } });
    });

    it('reads text files as the state, as the bot read them before', async () => {
        spyOn(console, 'log').mockImplementation(() => undefined);
        const body = await sentBody(file('text/plain', Buffer.from('Statement: 3 rows', 'utf8').toString('base64')));

        expect(body.state).toEqual({ document: 'Statement: 3 rows' });
        expect(body.assets).toBeUndefined();
    });

    it('reads a statement only from the threshold up: when unsure, one transaction', async () => {
        spyOn(console, 'log').mockImplementation(() => undefined);
        const pdf = file('application/pdf', 'JVBERi0xLjQK');

        expect(await classifier(pdf, () => choiceResponse(STATEMENT_PROBABILITY_THRESHOLD)).extract()).toEqual({ kind: 'statement' });
        expect(await classifier(pdf, () => choiceResponse(STATEMENT_PROBABILITY_THRESHOLD - 0.01)).extract()).toEqual({ kind: 'single_transaction' });
        expect(STATEMENT_PROBABILITY_THRESHOLD).toBeGreaterThan(0.5);
    });

    it('does not call Bkper AI for a file without content', async () => {
        const requests: Request[] = [];
        expect(await classifier(file('application/pdf', undefined), () => choiceResponse(1), requests).extract()).toBeUndefined();
        expect(requests).toHaveLength(0);
    });

    it('fails instead of guessing when Bkper AI rejects the file', async () => {
        spyOn(console, 'log').mockImplementation(() => undefined);
        const rejection = () => Response.json(
            { error: { type: 'invalid_request_error', code: 'unsupported_parameter', param: 'assets.uploaded-file.media_type', message: 'Unsupported.' } },
            { status: 400 }
        );

        const error = await classifier(file('application/zip', 'UEsDBA=='), rejection).extract().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BkperAIClientError);
        expect(error).toMatchObject({ code: 'unsupported_parameter' });
    });
});
