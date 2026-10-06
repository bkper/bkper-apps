import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { BkperAIEvaluationsClient } from '../../src/genai/BkperAIEvaluationsClient.js';

function fetchMock(callback: (request: Request) => Promise<Response>): typeof fetch {
    return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        return callback(new Request(input, init));
    }, { preconnect: fetch.preconnect });
}

function decisionResponse(noul = 0.94): Response {
    return Response.json({
        model: 'jev-1.13.0',
        answers: { pair_0: { type: 'noul', noul } },
        usage: { input_tokens: 20, output_tokens: 0 },
    });
}

// `retry-after-ms: 0` keeps SDK retries instant in tests.
function aiError(status: number, code: string): Response {
    return Response.json(
        { error: { code, message: 'Safe upstream message.' } },
        { status, headers: { 'retry-after-ms': '0' } }
    );
}

function evaluationRequest(signal?: AbortSignal) {
    return {
        evaluationKind: 'invoice_description_equivalence' as const,
        state: { pairs: [{ id: 'pair_0', first: 'A', second: 'B' }] },
        questions: {
            pair_0: {
                instructions: 'Decide whether the descriptions are materially equivalent.',
                criteria: {
                    true: 'They describe the same purchased goods or services.',
                    false: 'They differ materially or the evidence is uncertain.',
                },
            },
        },
        context: { document_kind: 'invoice' as const, stage: 'post_validation' as const, epoch: 2 },
        signal,
    };
}

describe('BkperAIEvaluationsClient evaluations', () => {
    afterEach(() => {
        spyOn(console, 'log').mockRestore();
        spyOn(console, 'error').mockRestore();
    });

    it('asks Jev noul questions through the TypeSafe SDK with the event token', async () => {
        let captured: Request | undefined;
        const client = new BkperAIEvaluationsClient({
            baseUrl: 'https://ai-dev.bkper.app/v1/',
            oauthToken: 'oauth-secret',
            fetch: fetchMock(async request => {
                captured = request;
                return decisionResponse(0.94);
            }),
        });

        const result = await client.evaluateBooleans(evaluationRequest());
        const body = await captured?.clone().json() as Record<string, unknown>;

        expect(captured?.url).toBe('https://ai-dev.bkper.app/v1/systemone');
        expect(captured?.headers.get('Authorization')).toBe('Bearer oauth-secret');
        expect(captured?.headers.get('bkper-ai-source')).toBe('bookbot');
        expect(captured?.headers.get('bkper-agent-id')).toBeNull();
        expect(body).toEqual({
            model: 'jev',
            state: { pairs: [{ id: 'pair_0', first: 'A', second: 'B' }] },
            questions: {
                pair_0: {
                    type: 'noul',
                    instructions: 'Decide whether the descriptions are materially equivalent.',
                    criteria: {
                        true: 'They describe the same purchased goods or services.',
                        false: 'They differ materially or the evidence is uncertain.',
                    },
                },
            },
        });
        expect(result).toEqual({ probabilities: { pair_0: 0.94 } });
    });

    it('calls fetch without a foreign receiver, as the Workers runtime requires', async () => {
        async function workersFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            if (this !== undefined && this !== globalThis) {
                throw new TypeError('Illegal invocation');
            }
            new Request(input, init);
            return decisionResponse(0.5);
        }
        const client = new BkperAIEvaluationsClient({
            baseUrl: 'https://ai.bkper.app/v1',
            oauthToken: 'token',
            fetch: Object.assign(workersFetch, { preconnect: fetch.preconnect }),
        });

        expect(await client.evaluateBooleans(evaluationRequest())).toEqual({ probabilities: { pair_0: 0.5 } });
    });

    it('emits payload-free evaluation telemetry', async () => {
        const logs: string[] = [];
        spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
            logs.push(values.map(String).join(' '));
        });
        const client = new BkperAIEvaluationsClient({
            baseUrl: 'https://ai-dev.bkper.app/v1',
            oauthToken: 'oauth-secret',
            fetch: fetchMock(async () => decisionResponse()),
        });

        await client.evaluateBooleans({
            ...evaluationRequest(),
            state: { private_description: 'PRIVATE INVOICE DESCRIPTION' },
        });

        const telemetry = logs.filter(line => line.startsWith('BKPER_AI_RESULT '));
        expect(telemetry).toHaveLength(1);
        expect(telemetry[0]).toContain('"evaluation_kind":"invoice_description_equivalence"');
        expect(telemetry[0]).toContain('"model":"jev"');
        expect(telemetry[0]).toContain('"input_tokens":20');
        expect(telemetry[0]).not.toContain('PRIVATE INVOICE DESCRIPTION');
        expect(telemetry[0]).not.toContain('oauth-secret');
        expect(telemetry[0]).not.toContain('materially equivalent');
    });

    it('preserves safe API errors once SDK retries are exhausted', async () => {
        const cases = [
            { status: 429, code: 'usage_limit_exceeded' },
            { status: 429, code: 'provider_rate_limited' },
            { status: 503, code: 'provider_overloaded' },
            { status: 400, code: 'invalid_request' },
        ];

        for (const item of cases) {
            const client = new BkperAIEvaluationsClient({
                baseUrl: 'https://ai-dev.bkper.app/v1',
                oauthToken: 'token',
                fetch: fetchMock(async () => aiError(item.status, item.code)),
            });

            try {
                await client.evaluateBooleans(evaluationRequest());
                throw new Error('Expected evaluation failure.');
            } catch (error) {
                expect(error).toBeInstanceOf(BkperAIClientError);
                expect(error).toMatchObject({
                    status: item.status,
                    code: item.code,
                    message: 'Safe upstream message.',
                    retryable: false,
                });
            }
        }
    });

    it('retries transient evaluation failures', async () => {
        let attempts = 0;
        const client = new BkperAIEvaluationsClient({
            baseUrl: 'https://ai-dev.bkper.app/v1',
            oauthToken: 'token',
            fetch: fetchMock(async () => {
                attempts++;
                return attempts === 1 ? aiError(503, 'provider_overloaded') : decisionResponse(0.94);
            }),
        });

        expect(await client.evaluateBooleans(evaluationRequest())).toEqual({
            probabilities: { pair_0: 0.94 },
        });
        expect(attempts).toBe(2);
    });

    it('uses the request signal and maps aborts without logging payloads', async () => {
        const controller = new AbortController();
        let requestSignal: AbortSignal | undefined;
        const client = new BkperAIEvaluationsClient({
            baseUrl: 'https://ai-dev.bkper.app/v1',
            oauthToken: 'token',
            signal: controller.signal,
            fetch: fetchMock(async request => {
                requestSignal = request.signal;
                controller.abort();
                throw new DOMException('The operation was aborted.', 'AbortError');
            }),
        });

        await expect(client.evaluateBooleans(evaluationRequest())).rejects.toMatchObject({
            status: 0,
            code: 'request_aborted',
            retryable: false,
        });
        expect(requestSignal?.aborted).toBe(true);
    });

    it('fails closed before fetch when OAuth or the base URL is missing', async () => {
        let called = false;
        const missingAuth = new BkperAIEvaluationsClient({
            baseUrl: 'https://ai-dev.bkper.app/v1',
            fetch: fetchMock(async () => {
                called = true;
                return Response.json({});
            }),
        });
        const missingUrl = new BkperAIEvaluationsClient({ oauthToken: 'token' });

        await expect(missingAuth.evaluateBooleans(evaluationRequest())).rejects.toMatchObject({
            code: 'missing_oauth_token',
        });
        await expect(missingUrl.evaluateBooleans(evaluationRequest())).rejects.toMatchObject({
            code: 'missing_bkper_ai_base_url',
        });
        expect(called).toBe(false);
    });
});
