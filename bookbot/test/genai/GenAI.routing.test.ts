import { afterEach, describe, expect, it } from 'bun:test';

import { GEMINI_MODEL_FLASH, GEMINI_MODEL_FLASH_LITE } from '../../src/constants.js';
import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';
import { ExtractorAmount } from '../../src/genai/ExtractorAmount.js';
import { GenAI } from '../../src/genai/GenAI.js';
import { JsonSchema } from '../../src/genai/JsonSchema.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

class FlashRoutingGenAI extends GenAI<{ answer: string }> {
    protected getModel(): string {
        return GEMINI_MODEL_FLASH;
    }

    protected getOperation(): 'transaction_extraction' {
        return 'transaction_extraction';
    }

    protected getSystemPrompt(): string {
        return 'Extract.';
    }

    protected getResponseSchema(): JsonSchema {
        return {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false,
        };
    }
}

function fetchMock(callback: (request: Request) => Promise<Response>): typeof fetch {
    return Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
        return callback(new Request(input, init));
    }, { preconnect: fetch.preconnect });
}

describe('GenAI Flash routing', () => {
    it('routes Flash only through the injected Bkper AI client', async () => {
        let calls = 0;
        let model: unknown;
        let reasoning: unknown;
        let temperature: unknown;
        const client = new BkperAIResponsesClient({
            baseUrl: 'http://localhost:8792/v1',
            oauthToken: 'token',
            fetch: fetchMock(async request => {
                calls++;
                const body = await request.json() as Record<string, unknown>;
                model = body.model;
                reasoning = body.reasoning;
                temperature = body.temperature;
                return Response.json({
                    status: 'completed',
                    output: [{
                        id: 'msg_1',
                        type: 'message',
                        role: 'assistant',
                        content: [{
                            type: 'output_text',
                            text: '{"answer":"ok"}',
                            annotations: [],
                        }],
                    }],
                });
            }),
        });
        const genAI = new FlashRoutingGenAI({} as Env, client);

        await expect(genAI.query([{ text: 'invoice' }])).resolves.toEqual({ answer: 'ok' });
        expect(calls).toBe(1);
        expect(model).toBe('gemini-flash');
        expect(reasoning).toEqual({ effort: 'medium' });
        expect(temperature).toBeUndefined();
    });

    it('fails closed when Flash has no request-scoped Bkper AI client', async () => {
        const genAI = new FlashRoutingGenAI({} as Env);

        await expect(genAI.query([{ text: 'invoice' }])).rejects.toThrow(
            'Bkper AI client is required for language-model inference.'
        );
    });
});

describe('GenAI Flash-Lite routing', () => {
    it('routes Bkper AI Flash-Lite through AI SDK with minimal reasoning', async () => {
        let requestUrl: string | undefined;
        let requestBody: Record<string, unknown> | undefined;
        let source: unknown;
        const client = new BkperAIResponsesClient({
            baseUrl: 'http://localhost:8792/v1',
            oauthToken: 'token',
            fetch: fetchMock(async request => {
                requestUrl = request.url;
                source = request.headers.get('bkper-ai-source');
                requestBody = await request.json() as Record<string, unknown>;
                return Response.json({
                    status: 'completed',
                    output: [{
                        id: 'msg_1',
                        type: 'message',
                        role: 'assistant',
                        content: [{
                            type: 'output_text',
                            text: '150.5',
                            annotations: [],
                        }],
                    }],
                });
            }),
        });
        const extractor = new ExtractorAmount({} as Env, client);

        const amount = await extractor.extract('Payment of $150.50 to vendor');

        expect(amount?.toNumber()).toBe(150.5);
        expect(requestUrl).toBe('http://localhost:8792/v1/responses');
        expect(requestBody?.model).toBe(GEMINI_MODEL_FLASH_LITE);
        expect(requestBody?.reasoning).toEqual({ effort: 'minimal' });
        expect(requestBody).not.toHaveProperty('temperature');
        expect(source).toBe('bookbot');
    });

    it('fails closed when Flash-Lite has no request-scoped Bkper AI client', async () => {
        const extractor = new ExtractorAmount({} as Env);

        await expect(extractor.query([{ text: 'invoice' }])).rejects.toThrow(
            'Bkper AI client is required for language-model inference.'
        );
    });
});
