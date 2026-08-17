import { describe, expect, it } from 'bun:test';
import { analyzeCandidatePairs } from '../src/services/bkper-ai-service';
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

describe('Bkper AI structured analysis', () => {
    it('sends one strict low-temperature request without identifiers or authorization headers', async () => {
        let captured: Request | undefined;
        const result = await analyzeCandidatePairs([pair], ['known example'], async input => {
            captured = input instanceof Request ? input : new Request(input);
            return Response.json({
                status: 'completed',
                output: [
                    {
                        type: 'message',
                        content: [
                            {
                                type: 'output_text',
                                text: JSON.stringify({
                                    evaluations: [
                                        {
                                            pairIndex: 0,
                                            duplicate: true,
                                            strength: 'Strong',
                                            explanation: 'Same merchant and movement.',
                                        },
                                    ],
                                }),
                            },
                        ],
                    },
                ],
            });
        });

        expect(result.evaluations).toHaveLength(1);
        expect(captured?.url).toBe('https://ai.bkper.app/v1/responses');
        expect(captured?.headers.get('authorization')).toBeNull();
        const body = (await captured?.clone().json()) as Record<string, unknown>;
        expect(body.model).toBe('gemini-3.6-flash');
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

    it('reports an empty AI response without exposing a JSON parser error', async () => {
        await expect(
            analyzeCandidatePairs([pair], [], async () => new Response(null, { status: 404 }))
        ).rejects.toThrow('Bkper AI returned an empty response (404).');
    });
});
