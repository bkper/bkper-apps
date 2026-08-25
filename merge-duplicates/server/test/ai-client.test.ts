import { describe, expect, it } from 'bun:test';
import { analyzeCandidateTransactions, BkperAiError } from '../src/services/bkper-ai-service';
import type { TransactionFingerprint } from '../src/services/candidate-service';

const pair: { first: TransactionFingerprint; second: TransactionFingerprint } = {
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

function completedResponse(
    pairs: Array<{
        firstIndex: number;
        secondIndex: number;
        strength: 'Strong' | 'Possible';
        explanation: string;
    }> = [
        {
            firstIndex: 0,
            secondIndex: 1,
            strength: 'Strong',
            explanation: 'Same merchant and movement.',
        },
    ]
): Response {
    return Response.json({
        status: 'completed',
        output: [
            {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify({ pairs }) }],
            },
        ],
    });
}

function aiError(status: number, code: string, message = 'Safe upstream message.'): Response {
    return Response.json({ error: { code, message } }, { status });
}

describe('Bkper AI structured analysis', () => {
    const transactions = [pair.first, pair.second];

    it('sends each candidate transaction once and requests a global non-overlapping match', async () => {
        let captured: Request | undefined;
        const result = await analyzeCandidateTransactions(
            transactions,
            ['known example'],
            async input => {
                captured = input instanceof Request ? input : new Request(input);
                return completedResponse();
            }
        );

        expect(result.pairs).toHaveLength(1);
        expect(captured?.url).toBe('https://ai.bkper.app/v1/responses');
        expect(captured?.headers.get('authorization')).toBeNull();
        const body = (await captured?.clone().json()) as Record<string, unknown>;
        expect(body.model).toBe('gemini-flash');
        expect(body.reasoning).toEqual({ effort: 'medium' });
        expect(body.temperature).toBe(0.1);
        expect(body.store).toBe(false);
        expect(body.text).toMatchObject({
            format: {
                type: 'json_schema',
                name: 'merge_duplicate_global_matching',
                strict: true,
            },
        });
        const input = body.input as Array<{ content: Array<{ text: string }> }>;
        const payload = JSON.parse(input[0]?.content[0]?.text ?? '{}') as Record<string, unknown>;
        expect(payload.candidateTransactions).toHaveLength(2);
        const candidateTransactions = payload.candidateTransactions as Array<
            Record<string, unknown>
        >;
        expect(candidateTransactions.map(transaction => transaction.draft)).toEqual([false, false]);
        expect(payload).not.toHaveProperty('candidatePairs');
        expect(payload).not.toHaveProperty('learningExamples');
        expect(payload.humanRejectedPairs).toEqual(['known example']);
        const serialized = JSON.stringify(body);
        const serializedPayload = JSON.stringify(payload);
        expect(serialized).toContain('merge-duplicates-v6');
        expect(serialized).toContain('Review the entire indexed transaction list');
        expect(serialized).toContain('Do not select an earlier weaker match');
        expect(serializedPayload).toContain('known example');
        expect(serializedPayload).not.toContain('secret-a');
        expect(serializedPayload).not.toContain('secret-account');
    });

    it('bounds text and omits hidden or oversized properties from the AI projection', async () => {
        const oversizedKey = 'k'.repeat(31);
        const boundedTransactions = transactions.map(transaction => ({
            ...transaction,
            description: 'd'.repeat(501),
            fromAccount: transaction.fromAccount
                ? { ...transaction.fromAccount, name: 'f'.repeat(501) }
                : null,
            toAccount: transaction.toAccount
                ? { ...transaction.toAccount, name: 't'.repeat(501) }
                : null,
            properties: {
                reference: 'invoice-123',
                hidden_: 'private',
                [oversizedKey]: 'oversized key',
                oversized_value: 'v'.repeat(257),
            },
        }));
        let captured: Request | undefined;

        await analyzeCandidateTransactions(boundedTransactions, [], async input => {
            captured = input instanceof Request ? input : new Request(input);
            return completedResponse();
        });

        const body = (await captured?.json()) as {
            input: Array<{ content: Array<{ text: string }> }>;
        };
        const payload = JSON.parse(body.input[0]?.content[0]?.text ?? '{}') as {
            candidateTransactions: Array<{
                description: string;
                fromAccount: { name: string };
                toAccount: { name: string };
                properties: Record<string, string>;
            }>;
        };
        for (const transaction of payload.candidateTransactions) {
            expect(transaction.description).toHaveLength(500);
            expect(transaction.fromAccount.name).toHaveLength(500);
            expect(transaction.toAccount.name).toHaveLength(500);
            expect(transaction.properties).toEqual({ reference: 'invoice-123' });
        }
    });

    it('drops learning examples and optional properties before exceeding the input budget', async () => {
        const properties = Object.fromEntries(
            Array.from({ length: 1_100 }, (_, index) => [`property_${index}`, 'v'.repeat(256)])
        );
        const largeTransactions = transactions.map(transaction => ({
            ...transaction,
            properties,
        }));
        let captured: Request | undefined;

        await analyzeCandidateTransactions(
            largeTransactions,
            ['learning context '.repeat(30_000)],
            async input => {
                captured = input instanceof Request ? input : new Request(input);
                return completedResponse();
            }
        );

        const body = (await captured?.json()) as {
            input: Array<{ content: Array<{ text: string }> }>;
        };
        const payload = JSON.parse(body.input[0]?.content[0]?.text ?? '{}') as {
            humanRejectedPairs: string[];
            candidateTransactions: Array<Record<string, unknown>>;
        };
        expect(payload.humanRejectedPairs).toEqual([]);
        expect(
            payload.candidateTransactions.every(transaction => !('properties' in transaction))
        ).toBe(true);
    });

    it('rejects oversized mandatory transaction context before calling AI', async () => {
        const largeTransactions = Array.from({ length: 400 }, (_, index) => ({
            ...pair.first,
            id: `transaction-${index}`,
            description: 'd'.repeat(500),
            fromAccount: { id: 'from-account', name: 'f'.repeat(500) },
            toAccount: { id: 'to-account', name: 't'.repeat(500) },
        }));
        let calls = 0;

        const analysis = analyzeCandidateTransactions(largeTransactions, [], async () => {
            calls += 1;
            return completedResponse();
        });

        await expect(analysis).rejects.toMatchObject({
            status: 400,
            code: 'analysis_input_too_large',
        });
        expect(calls).toBe(0);
    });

    it('accepts a selected draft pair despite conflicting discovered Accounts', async () => {
        const discoveredDraft: TransactionFingerprint = {
            ...pair.second,
            id: 'secret-draft',
            fromAccount: { id: 'wrong-account', name: 'Discovered Card' },
            toAccount: { id: 'wrong-category', name: 'Discovered Meals' },
            draft: true,
        };

        const result = await analyzeCandidateTransactions(
            [pair.first, discoveredDraft],
            [],
            async () => completedResponse()
        );

        expect(result.pairs).toHaveLength(1);
    });

    it('falls back to Luna with compatible controls after Gemini rejects the request', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const result = await analyzeCandidateTransactions(transactions, [], async input => {
            const request = input instanceof Request ? input : new Request(input);
            requests.push((await request.json()) as Record<string, unknown>);
            return requests.length === 1 ? aiError(400, 'provider_rejected') : completedResponse();
        });

        expect(result.pairs).toHaveLength(1);
        expect(requests.map(request => request.model)).toEqual(['gemini-flash', 'gpt-luna']);
        expect(requests[1]?.reasoning).toEqual({ effort: 'high' });
        expect(requests[1]).not.toHaveProperty('temperature');
    });

    it('falls back when output overlaps transactions', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const third = { ...pair.second, id: 'secret-c', description: 'Third coffee' };
        const result = await analyzeCandidateTransactions(
            [...transactions, third],
            [],
            async input => {
                const request = input instanceof Request ? input : new Request(input);
                requests.push((await request.json()) as Record<string, unknown>);
                if (requests.length === 1) {
                    return completedResponse([
                        {
                            firstIndex: 0,
                            secondIndex: 1,
                            strength: 'Strong',
                            explanation: 'First match.',
                        },
                        {
                            firstIndex: 0,
                            secondIndex: 2,
                            strength: 'Possible',
                            explanation: 'Overlapping match.',
                        },
                    ]);
                }
                return completedResponse([]);
            }
        );

        expect(result.pairs).toEqual([]);
        expect(requests.map(request => request.model)).toEqual(['gemini-flash', 'gpt-luna']);
    });

    it('falls back when a proposed pair violates deterministic constraints', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const unrelated = { ...pair.second, id: 'secret-c', amount: '99.00' };
        const result = await analyzeCandidateTransactions(
            [pair.first, unrelated],
            [],
            async input => {
                const request = input instanceof Request ? input : new Request(input);
                requests.push((await request.json()) as Record<string, unknown>);
                return requests.length === 1 ? completedResponse() : completedResponse([]);
            }
        );

        expect(result.pairs).toEqual([]);
        expect(requests.map(request => request.model)).toEqual(['gemini-flash', 'gpt-luna']);
    });

    it('falls back to DeepSeek when Luna returns invalid structured output', async () => {
        const requests: Array<Record<string, unknown>> = [];
        const result = await analyzeCandidateTransactions(transactions, [], async input => {
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

        expect(result.pairs).toHaveLength(1);
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
            await analyzeCandidateTransactions(transactions, [], async () => {
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
        const failure = analyzeCandidateTransactions(transactions, [], async () => {
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
