import { describe, expect, it } from 'bun:test';
import { analyzeCandidateTransactions, BkperAiError } from '../src/services/bkper-ai-service';
import type { TransactionFingerprint } from '../src/services/candidate-service';

const pair: { first: TransactionFingerprint; second: TransactionFingerprint } = {
    first: {
        id: 'secret-a',
        date: '2026-06-10',
        amount: '12.50',
        description: 'Coffee',
        fromAccount: { id: 'secret-account', name: 'Card', type: 'ASSET' },
        toAccount: { id: 'secret-category', name: 'Meals', type: 'OUTGOING' },
        properties: { merchant: 'Cafe' },
        draft: false,
    },
    second: {
        id: 'secret-b',
        date: '2026-06-11',
        amount: '12.50',
        description: 'CAFE',
        fromAccount: { id: 'secret-account', name: 'Card', type: 'ASSET' },
        toAccount: { id: 'secret-category', name: 'Meals', type: 'OUTGOING' },
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
            candidateTransactions?: unknown;
        };
        expect(state.humanRejectedPairs).toEqual(['known false positive']);
        expect(state).not.toHaveProperty('candidateTransactions');
        expect(JSON.stringify(captured)).not.toContain('secret-account');
        const questions = captured?.questions as Record<
            string,
            {
                criteria: readonly string[];
                instructions: {
                    transactions: Array<Record<string, unknown>>;
                    movementTopology: Record<string, boolean>;
                };
            }
        >;
        expect(Object.keys(questions)).toEqual(['pair_0_1']);
        expect(questions.pair_0_1?.criteria).toHaveLength(3);
        expect(questions.pair_0_1?.criteria.every(item => typeof item === 'string')).toBe(true);
        expect(questions.pair_0_1?.instructions.transactions).toHaveLength(2);
        expect(questions.pair_0_1?.instructions.transactions[0]).toMatchObject({
            fromAccount: { name: 'Card', type: 'ASSET' },
            toAccount: { name: 'Meals', type: 'OUTGOING' },
        });
        expect(questions.pair_0_1?.instructions.transactions[0]).not.toHaveProperty('id');
        expect(questions.pair_0_1?.instructions.movementTopology).toEqual({
            sameFromAccount: true,
            sameToAccount: true,
            samePath: true,
            sharedAcrossOppositeSides: false,
            sameDescription: false,
            sameDate: false,
        });
        expect(result).toEqual({
            pairs: [
                {
                    firstIndex: 0,
                    secondIndex: 1,
                    strength: 'Strong',
                    explanation: 'Same From Account: Card · 1 day apart',
                },
            ],
            batchCount: 1,
        });
    });

    it('uses the most probable level, resolves ties toward Different, and preserves listing order', async () => {
        const transactions = [
            pair.first,
            pair.second,
            { ...pair.first, id: 'possible-a', amount: '20' },
            { ...pair.second, id: 'possible-b', amount: '20' },
            { ...pair.first, id: 'strong-a', amount: '30' },
            { ...pair.second, id: 'strong-b', amount: '30' },
            { ...pair.first, id: 'tie-a', amount: '40' },
            { ...pair.second, id: 'tie-b', amount: '40' },
        ];
        const result = await analyzeCandidateTransactions(transactions, [], async () =>
            Response.json({
                model: 'jev',
                answers: {
                    pair_0_1: {
                        type: 'score',
                        score: 0.68,
                        probabilities: { '0': 0.51, '1': 0.3, '2': 0.19 },
                    },
                    pair_2_3: {
                        type: 'score',
                        score: 0.4,
                        probabilities: { '0': 0.2, '1': 0.7, '2': 0.1 },
                    },
                    pair_4_5: {
                        type: 'score',
                        score: 1.4,
                        probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
                    },
                    pair_6_7: {
                        type: 'score',
                        score: 0.5,
                        probabilities: { '0': 0.5, '1': 0.5, '2': 0 },
                    },
                },
                usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
            })
        );

        expect(result.pairs).toEqual([
            expect.objectContaining({ firstIndex: 2, secondIndex: 3, strength: 'Possible' }),
            expect.objectContaining({ firstIndex: 4, secondIndex: 5, strength: 'Strong' }),
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

    it('packs more than twenty-five questions into one request when they fit', async () => {
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

        expect(questionCounts[0]).toBeGreaterThan(25);
        expect(questionCounts.reduce((total, count) => total + count, 0)).toBe(105);
        expect(result.pairs).toEqual([]);
        expect(result.batchCount).toBe(questionCounts.length);
    });

    it('splits questions only when the request-size budget requires it', async () => {
        const transactions = Array.from({ length: 25 }, (_, index) => ({
            ...pair.first,
            id: `transaction-${index}`,
            description: `Transaction ${index}`,
        }));
        const questionCounts: number[] = [];
        const requestBytes: number[] = [];

        const result = await analyzeCandidateTransactions(transactions, [], async input => {
            const request = input instanceof Request ? input : new Request(input);
            const text = await request.text();
            const body = JSON.parse(text) as Record<string, unknown>;
            questionCounts.push(Object.keys(body.questions as Record<string, unknown>).length);
            requestBytes.push(new TextEncoder().encode(text).byteLength);
            return evaluationResponse(body, 0);
        });

        expect(questionCounts.length).toBeGreaterThan(1);
        expect(questionCounts[0]).toBeGreaterThan(25);
        expect(questionCounts.reduce((total, count) => total + count, 0)).toBe(300);
        expect(requestBytes.every(bytes => bytes <= 100_000)).toBe(true);
        expect(result.batchCount).toBe(questionCounts.length);
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

        const questions = captured?.questions as Record<
            string,
            {
                instructions: {
                    transactions: Array<{
                        description: string;
                        fromAccount: { name: string };
                        properties: Record<string, string>;
                    }>;
                };
            }
        >;
        for (const transaction of questions.pair_0_1.instructions.transactions) {
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
