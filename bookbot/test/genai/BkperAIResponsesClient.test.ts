import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';

const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function completeSuccessfulResponse(response: Response): Promise<Response> {
    if (!response.ok) return response;
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.output)) {
        return Response.json(payload, { status: response.status, headers: response.headers });
    }
    const output = payload.output.map((item, itemIndex) => {
        if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) return item;
        return {
            id: `msg_${itemIndex}`,
            role: 'assistant',
            ...item,
            content: item.content.map(part => isRecord(part) && part.type === 'output_text'
                ? { annotations: [], ...part }
                : part
            ),
        };
    });
    return Response.json({ ...payload, output }, { status: response.status, headers: response.headers });
}

function fetchMock(callback: (request: Request) => Promise<Response>): typeof fetch {
    return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await callback(new Request(input, init));
        return completeSuccessfulResponse(response);
    }, { preconnect: fetch.preconnect });
}

describe('BkperAIResponsesClient', () => {
    afterEach(() => {
        spyOn(console, 'log').mockRestore();
        spyOn(console, 'error').mockRestore();
    });

    it('sends request-scoped bearer auth, Bkper AI source attribution, and no metadata', async () => {
        let captured: Request | undefined;
        const client = new BkperAIResponsesClient({
            baseUrl: 'http://localhost:8792/v1',
            oauthToken: 'oauth-secret',
            fetch: fetchMock(async request => {
                captured = request;
                return Response.json({
                    id: 'resp_1', status: 'completed', model: 'gemini-flash',
                    output: [{
                        type: 'message', role: 'assistant',
                        content: [{ type: 'output_text', text: '{"answer":"ok"}' }],
                    }],
                    usage: {
                        input_tokens: 10, output_tokens: 3, total_tokens: 13,
                        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
                        output_tokens_details: { reasoning_tokens: 2 },
                    },
                });
            }),
        });

        const result = await client.generate({
            operation: 'transaction_extraction',
            model: 'gemini-flash',
            systemPrompt: 'Extract.',
            contents: [{ text: 'Invoice text' }],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        });
        const body = await captured?.clone().json() as Record<string, unknown>;

        expect(captured?.url).toBe('http://localhost:8792/v1/responses');
        expect(captured?.headers.get('Authorization')).toBe('Bearer oauth-secret');
        expect(captured?.headers.get('bkper-ai-source')).toBe('bookbot');
        expect(captured?.headers.get('bkper-agent-id')).toBeNull();
        expect(body).not.toHaveProperty('metadata');
        expect(body).not.toHaveProperty('max_output_tokens');
        expect(body).not.toHaveProperty('stream');
        expect(body).toMatchObject({
            model: 'gemini-flash',
            instructions: 'Extract.',
            reasoning: { effort: 'high' },
            store: false,
            text: { format: { type: 'json_schema', name: 'answer', schema, strict: true } },
        });
        expect(result).toEqual({
            value: { answer: 'ok' },
            usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, reasoningTokens: 2 },
        });
    });

    it('maps PDF, image, and CSV text without provider-native response fields', async () => {
        let body: Record<string, unknown> = {};
        const client = new BkperAIResponsesClient({
            baseUrl: 'https://ai-dev.bkper.app/v1/',
            oauthToken: 'token',
            fetch: fetchMock(async request => {
                body = await request.json() as Record<string, unknown>;
                return Response.json({
                    status: 'completed',
                    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"ok"}' }] }],
                });
            }),
        });

        await client.generate({
            operation: 'transactions_extraction',
            model: 'gemini-flash',
            systemPrompt: 'Extract.',
            contents: [
                { text: 'Analyze CSV.' },
                { inlineData: { mimeType: 'text/csv', data: btoa('date,amount\n2025-01-01,10') } },
                { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQ=' } },
                { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            ],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        });

        expect(body.input).toEqual([{
            role: 'user',
            content: [
                { type: 'input_text', text: 'Analyze CSV.' },
                { type: 'input_text', text: 'date,amount\n2025-01-01,10' },
                { type: 'input_file', filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQ=' },
                { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'high' },
            ],
        }]);
    });

    it('fails closed without OAuth auth and classifies quota as non-retryable', async () => {
        let called = false;
        const missing = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1',
            fetch: fetchMock(async () => {
                called = true;
                return Response.json({});
            }),
        });

        await expect(missing.generate({
            operation: 'transaction_extraction', model: 'gemini-flash',
            systemPrompt: '', contents: [{ text: 'x' }],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        })).rejects.toMatchObject({ code: 'missing_oauth_token', retryable: false });
        expect(called).toBe(false);

        const quota = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1', oauthToken: 'token',
            fetch: fetchMock(async () => Response.json({
                error: { code: 'usage_limit_exceeded', message: 'limit' },
            }, { status: 429 })),
        });
        try {
            await quota.generate({
                operation: 'transaction_extraction', model: 'gemini-flash',
                systemPrompt: '', contents: [{ text: 'x' }],
                responseFormat: { name: 'answer', schema, strict: true },
                reasoningEffort: 'high',
            });
            throw new Error('Expected quota error.');
        } catch (error) {
            expect(error).toBeInstanceOf(BkperAIClientError);
            expect(error).toMatchObject({ status: 429, code: 'usage_limit_exceeded', retryable: false });
        }
    });

    it('invokes fetch without binding the BkperAIResponsesClient as its receiver', async () => {
        let receiver: unknown = 'not-called';
        const standaloneFetch = Object.assign(function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
            receiver = this;
            return completeSuccessfulResponse(Response.json({
                status: 'completed',
                output: [{
                    type: 'message',
                    content: [{ type: 'output_text', text: '{"answer":"ok"}' }],
                }],
            }));
        }, { preconnect: fetch.preconnect });
        const client = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1',
            oauthToken: 'oauth-token',
            fetch: standaloneFetch,
        });

        await client.generate({
            operation: 'transaction_extraction', model: 'gemini-flash',
            systemPrompt: '', contents: [{ text: 'x' }],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        });

        expect(receiver).toBeUndefined();
    });

    it('logs safe underlying fetch diagnostics without exposing the OAuth token', async () => {
        const errors: string[] = [];
        spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            errors.push(values.map(String).join(' '));
        });
        const cause = new Error('connect ECONNREFUSED 127.0.0.1:443');
        const fetchError = new TypeError('fetch failed');
        Object.defineProperty(fetchError, 'cause', { value: cause });
        const client = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1',
            oauthToken: 'oauth-secret',
            fetch: fetchMock(async () => {
                throw fetchError;
            }),
        });

        await expect(client.generate({
            operation: 'transaction_extraction', model: 'gemini-flash',
            systemPrompt: '', contents: [{ text: 'private document content' }],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        })).rejects.toMatchObject({ status: 0, code: 'connection_error', retryable: true });

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('BKPER_AI_CONNECTION_ERROR');
        expect(errors[0]).toContain('connect ECONNREFUSED 127.0.0.1:443');
        expect(errors[0]).not.toContain('oauth-secret');
        expect(errors[0]).not.toContain('private document content');
    });

    it('uses the request-scoped default abort signal', async () => {
        let signal: AbortSignal | null | undefined;
        const controller = new AbortController();
        const client = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1',
            oauthToken: 'token',
            signal: controller.signal,
            fetch: fetchMock(async request => {
                signal = request.signal;
                return Response.json({
                    status: 'completed',
                    output: [{
                        type: 'message',
                        content: [{ type: 'output_text', text: '{"answer":"ok"}' }],
                    }],
                });
            }),
        });

        await client.generate({
            operation: 'transaction_extraction', model: 'gemini-flash',
            systemPrompt: '', contents: [{ text: 'x' }],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        });

        expect(signal).toBe(controller.signal);
    });

    it('returns a schema-valid top-level null with one successful terminal result', async () => {
        const logs: string[] = [];
        spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
            logs.push(values.map(String).join(' '));
        });
        const client = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1', oauthToken: 'token',
            fetch: fetchMock(async () => Response.json({
                status: 'completed',
                output: [{
                    type: 'message',
                    content: [{ type: 'output_text', text: 'null' }],
                }],
                usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
            })),
        });

        await expect(client.generate({
            operation: 'amount_extraction', model: 'gemini-flash-lite',
            systemPrompt: '', contents: [{ text: 'no amount' }],
            responseFormat: {
                name: 'amount',
                schema: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                strict: true,
            },
            reasoningEffort: 'minimal',
        })).resolves.toEqual({
            value: null,
            usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, reasoningTokens: 0 },
        });

        const results = logs.filter(line => line.startsWith('BKPER_AI_RESULT '));
        expect(results).toHaveLength(1);
        expect(results[0]).toContain('"outcome":"success"');
    });

    it('emits failure rather than success for domain-invalid structured output', async () => {
        const logs: string[] = [];
        spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
            logs.push(values.map(String).join(' '));
        });
        const client = new BkperAIResponsesClient({
            baseUrl: 'https://ai.bkper.app/v1', oauthToken: 'token',
            fetch: fetchMock(async () => Response.json({
                status: 'completed',
                output: [{
                    type: 'message',
                    content: [{ type: 'output_text', text: '{"unexpected":"value"}' }],
                }],
                usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
            })),
        });

        await expect(client.generate({
            operation: 'transaction_extraction', model: 'gemini-flash',
            systemPrompt: '', contents: [{ text: 'x' }],
            responseFormat: { name: 'answer', schema, strict: true },
            reasoningEffort: 'high',
        })).rejects.toMatchObject({ code: 'structured_output_schema_mismatch', retryable: false });

        const results = logs.filter(line => line.startsWith('BKPER_AI_RESULT '));
        expect(results).toHaveLength(1);
        expect(results[0]).toContain('"outcome":"structured_output_schema_mismatch"');
        expect(results[0]).not.toContain('"outcome":"success"');
    });

    it('classifies only recognized transient failures as retryable and propagates abort', async () => {
        const cases = [
            { status: 408, code: 'provider_timeout', retryable: true },
            { status: 429, code: 'provider_rate_limited', retryable: true },
            { status: 503, code: 'provider_rejected', retryable: true },
            { status: 400, code: 'invalid_request', retryable: false },
        ];
        for (const item of cases) {
            let signal: AbortSignal | null | undefined;
            const client = new BkperAIResponsesClient({
                baseUrl: 'https://ai.bkper.app/v1', oauthToken: 'token',
                fetch: fetchMock(async request => {
                    signal = request.signal;
                    return Response.json({ error: { code: item.code, message: 'safe' } }, { status: item.status });
                }),
            });
            const controller = new AbortController();
            try {
                await client.generate({
                    operation: 'transaction_extraction', model: 'gemini-flash',
                    systemPrompt: '', contents: [{ text: 'x' }],
                    responseFormat: { name: 'answer', schema, strict: true },
                    reasoningEffort: 'high', signal: controller.signal,
                });
                throw new Error('Expected client error.');
            } catch (error) {
                expect(error).toMatchObject({ status: item.status, code: item.code, retryable: item.retryable });
            }
            expect(signal).toBe(controller.signal);
        }
    });
});
