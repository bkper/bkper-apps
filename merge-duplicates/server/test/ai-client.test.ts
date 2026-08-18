import { describe, expect, it } from 'bun:test';
import { analyzeCandidatePairs, BkperAiError } from '../src/services/bkper-ai-service';
import type { CandidatePair } from '../src/services/candidate-service';

const pair: CandidatePair = {
    key: 'secret-a|secret-b',
    first: {
        id: 'secret-a',
        date: '2026-06-10',
        amount: '12.50',
        description: 'Coffee',
        fromAccount: { id: 'secret-account', name: 'Card' },
        toAccount: { id: 'secret-category', name: 'Meals' },
        properties: { merchant: 'Cafe' },
        draft: false,
    },
    second: {
        id: 'secret-b',
        date: '2026-06-11',
        amount: '12.50',
        description: 'CAFE',
        fromAccount: { id: 'secret-account', name: 'Card' },
        toAccount: { id: 'secret-category', name: 'Meals' },
        properties: {},
        draft: false,
    },
};

function completedResponse(pairCount = 1): Response {
    return Response.json({
        status: 'completed',
        output: [
            {
                type: 'message',
                content: [
                    {
                        type: 'output_text',
                        text: JSON.stringify({
                            evaluations: Array.from({ length: pairCount }, (_, pairIndex) => ({
                                pairIndex,
                                duplicate: true,
                                strength: 'Strong',
                                explanation: 'Same merchant and movement.',
                            })),
                        }),
                    },
                ],
            },
        ],
    });
}

function aiError(status: number, code: string, message = 'Safe upstream message.'): Response {
    return Response.json({ error: { code, message } }, { status });
}

describe('Bkper AI structured analysis', () => {
    it('sends one strict low-temperature request without identifiers or authorization headers', async () => {
        let captured: Request | undefined;
        const result = await analyzeCandidatePairs([pair], ['known example'], async input => {
            captured = input instanceof Request ? input : new Request(input);
            return completedResponse();
        });

        expect(result.evaluations).toHaveLength(1);
        expect(captured?.url).toBe('https://ai.bkper.app/v1/responses');
        expect(captured?.headers.get('authorization')).toBeNull();
        const body = (await captured?.clone().json()) as Record<string, unknown>;
        expect(body.model).toBe('gemini-flash');
        expect(body.temperature).toBe(0.1);
        expect(body.store).toBe(false);
        expect(body.text).toMatchObject({ format: { type: 'json_schema', strict: true } });
        const serialized = JSON.stringify(body);
        expect(serialized).toContain('merge-duplicates-v1');
        expect(serialized).toContain('known example');
        expect(serialized).not.toContain('secret-a');
        expect(serialized).not.toContain('secret-account');
        expect(serialized).not.toContain('draft');
    });

    it('falls back to Luna with compatible controls after Gemini rejects the request', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const result = await analyzeCandidatePairs([pair], [], async input => {
            const request = input instanceof Request ? input : new Request(input);
            requests.push((await request.json()) as Record<string, unknown>);
            return requests.length === 1 ? aiError(400, 'provider_rejected') : completedResponse();
        });

        expect(result.evaluations).toHaveLength(1);
        expect(requests.map(request => request.model)).toEqual(['gemini-flash', 'gpt-luna']);
        expect(requests[1]?.reasoning).toEqual({ effort: 'high' });
        expect(requests[1]).not.toHaveProperty('temperature');
    });

    it('falls back to DeepSeek when Luna returns invalid structured output', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const result = await analyzeCandidatePairs([pair], [], async input => {
            const request = input instanceof Request ? input : new Request(input);
            requests.push((await request.json()) as Record<string, unknown>);
            if (requests.length === 1) return aiError(503, 'provider_rejected');
            if (requests.length === 2) {
                return Response.json({
                    status: 'completed',
                    output: [
                        {
                            type: 'message',
                            content: [{ type: 'output_text', text: '{}' }],
                        },
                    ],
                });
            }
            return completedResponse();
        });

        expect(result.evaluations).toHaveLength(1);
        expect(requests.map(request => request.model)).toEqual([
            'gemini-flash',
            'gpt-luna',
            'deepseek-flash',
        ]);
        expect(requests[2]?.reasoning).toEqual({ effort: 'high' });
        expect(requests[2]).not.toHaveProperty('temperature');
    });

    it('does not retry an exhausted shared AI allowance', async () => {
        let calls = 0;
        try {
            await analyzeCandidatePairs([pair], [], async () => {
                calls += 1;
                return aiError(429, 'usage_limit_exceeded', 'AI allowance exhausted.');
            });
            throw new Error('Expected analysis to fail.');
        } catch (error) {
            expect(error).toBeInstanceOf(BkperAiError);
            expect(error).toMatchObject({
                status: 429,
                code: 'usage_limit_exceeded',
                message: 'AI allowance exhausted.',
            });
        }
        expect(calls).toBe(1);
    });

    it('reports safe diagnostics after every provider fails', async () => {
        let calls = 0;
        const failure = analyzeCandidatePairs([pair], [], async () => {
            calls += 1;
            if (calls === 1) return aiError(400, 'provider_rejected');
            if (calls === 2) return aiError(429, 'provider_rate_limited');
            return aiError(503, 'provider_rejected');
        });

        await expect(failure).rejects.toThrow(
            'AI analysis failed after 3 attempts: gemini-flash (provider_rejected, 400), gpt-luna (provider_rate_limited, 429), deepseek-flash (provider_rejected, 503).'
        );
    });
});
