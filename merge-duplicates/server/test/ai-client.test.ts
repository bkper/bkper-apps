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

function evaluationResponse(
    request: Record<string, unknown>,
    scores: Record<string, number> | number = 2
): Response {
    const questions = request.questions as Record<string, unknown>;
    return Response.json({
        model: 'jev',
        answers: Object.fromEntries(
            Object.keys(questions).map(id => {
                const score = typeof scores === 'number' ? scores : (scores[id] ?? 0);
                const rounded = Math.max(0, Math.min(2, Math.round(score)));
                return [
                    id,
                    {
                        type: 'score',
                        score,
                        probabilities: {
                            '0': rounded === 0 ? 1 : 0,
                            '1': rounded === 1 ? 1 : 0,
                            '2': rounded === 2 ? 1 : 0,
                        },
                    },
                ];
            })
        ),
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    });
}

function aiError(status: number, code: string, message = 'Safe upstream message.'): Response {
    return Response.json({ error: { code, message } }, { status });
}

describe('Bkper AI Jev evaluation', () => {
    it('scores candidate pairs with Jev while omitting internal identifiers', async () => {
        let captured: Record<string, unknown> | undefined;
        const result = await analyzeCandidateTransactions(
            [pair.first, pair.second],
            ['known false positive'],
            async input => {
                const request = input instanceof Request ? input : new Request(input);
                captured = (await request.json()) as Record<string, unknown>;
                return evaluationResponse(captured, 2);
            }
        );

        expect(captured).toMatchObject({ model: 'jev' });
        const state = captured?.state as {
            humanRejectedPairs: string[];
            candidateTransactions: Array<Record<string, unknown>>;
        };
        expect(state.humanRejectedPairs).toEqual(['known false positive']);
        expect(state.candidateTransactions).toHaveLength(2);
        expect(state.candidateTransactions[0]).not.toHaveProperty('id');
        expect(JSON.stringify(captured)).not.toContain('secret-account');
        const questions = captured?.questions as Record<string, { criteria: readonly string[] }>;
        expect(Object.keys(questions)).toEqual(['pair_0_1']);
        expect(questions.pair_0_1?.criteria).toEqual([
            'Different movement: the records describe different real-world movements, conflict materially, or match a human-rejected false positive.',
            'Possible duplicate: the records may describe the same real-world movement, but the semantic evidence is not compelling.',
            'Strong duplicate: the records compellingly describe one and the same real-world movement.',
        ]);
        expect(result).toEqual({
            pairs: [
                {
                    firstIndex: 0,
                    secondIndex: 1,
                    strength: 'Strong',
                    explanation: 'Same From Account: Card · 1 day apart',
                },
            ],
        });
    });

    it('maps the three score levels to discard, Possible, and Strong', async () => {
        const third = { ...pair.second, id: 'secret-c', description: 'Parking' };
        const result = await analyzeCandidateTransactions(
            [pair.first, pair.second, third],
            [],
            async input => {
                const request = input instanceof Request ? input : new Request(input);
                const body = (await request.json()) as Record<string, unknown>;
                return evaluationResponse(body, {
                    pair_0_1: 0.49,
                    pair_0_2: 0.75,
                    pair_1_2: 1.75,
                });
            }
        );

        expect(result.pairs).toEqual([
            expect.objectContaining({ firstIndex: 1, secondIndex: 2, strength: 'Strong' }),
        ]);
    });

    it('selects globally ranked non-overlapping pairs', async () => {
        const third = { ...pair.second, id: 'secret-c' };
        const fourth = { ...pair.second, id: 'secret-d' };
        const result = await analyzeCandidateTransactions(
            [pair.first, pair.second, third, fourth],
            [],
            async input => {
                const request = input instanceof Request ? input : new Request(input);
                const body = (await request.json()) as Record<string, unknown>;
                return evaluationResponse(body, {
                    pair_0_1: 1.95,
                    pair_0_2: 1.8,
                    pair_0_3: 0,
                    pair_1_2: 0,
                    pair_1_3: 1.7,
                    pair_2_3: 1.6,
                });
            }
        );

        expect(result.pairs.map(item => [item.firstIndex, item.secondIndex])).toEqual([
            [0, 1],
            [2, 3],
        ]);
    });

    it('splits large candidate sets into bounded multi-question requests', async () => {
        const transactions = Array.from({ length: 15 }, (_, index) => ({
            ...pair.first,
            id: `transaction-${index}`,
            description: `Transaction ${index}`,
        }));
        const questionCounts: number[] = [];

        const result = await analyzeCandidateTransactions(transactions, [], async input => {
            const request = input instanceof Request ? input : new Request(input);
            const body = (await request.json()) as Record<string, unknown>;
            questionCounts.push(Object.keys(body.questions as Record<string, unknown>).length);
            return evaluationResponse(body, 0);
        });

        expect(questionCounts).toEqual([25, 25, 25, 25, 5]);
        expect(result.pairs).toEqual([]);
    });

    it('bounds transaction text and omits hidden or oversized properties', async () => {
        const oversizedKey = 'k'.repeat(31);
        const transactions = [pair.first, pair.second].map(transaction => ({
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
        let captured: Record<string, unknown> | undefined;

        await analyzeCandidateTransactions(transactions, [], async input => {
            const request = input instanceof Request ? input : new Request(input);
            captured = (await request.json()) as Record<string, unknown>;
            return evaluationResponse(captured, 2);
        });

        const state = captured?.state as {
            candidateTransactions: Array<{
                description: string;
                fromAccount: { name: string };
                properties: Record<string, string>;
            }>;
        };
        for (const transaction of state.candidateTransactions) {
            expect(transaction.description).toHaveLength(200);
            expect(transaction.fromAccount.name).toHaveLength(200);
            expect(transaction.properties).toEqual({ reference: 'invoice-123' });
        }
    });

    it('preserves Bkper AI errors without trying another model', async () => {
        let calls = 0;
        try {
            await analyzeCandidateTransactions([pair.first, pair.second], [], async () => {
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

    it('rejects incomplete evaluation answers', async () => {
        const analysis = analyzeCandidateTransactions([pair.first, pair.second], [], async () =>
            Response.json({
                model: 'jev',
                answers: {},
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            })
        );

        await expect(analysis).rejects.toMatchObject({
            status: 502,
            code: 'invalid_response',
        });
    });
});
