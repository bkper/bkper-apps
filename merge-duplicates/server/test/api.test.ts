import { describe, expect, it } from 'bun:test';
import { Permission, type Bkper, type Book, type Transaction } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { createApp } from '../src/index';
import type { PerformanceMonitor } from '../src/observability';

function contextWithBook(
    book: Book,
    aiFetch: typeof fetch = fetch,
    performanceMonitor?: PerformanceMonitor
) {
    const bkper = { getBook: async () => book } as unknown as Bkper;
    return () => new AppContext(bkper, { ASSETS: { fetch } }, aiFetch, performanceMonitor);
}

function transaction(id: string, overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id,
        date: '2026-08-03',
        dateFormatted: '03/08/2026',
        amount: '10.00',
        description: `Transaction ${id}`,
        posted: true,
        creditAccount: { id: 'bank', name: 'Bank', type: 'ASSET' },
        debitAccount: { id: 'expense', name: 'Expense', type: 'OUTGOING' },
        properties: {},
        ...overrides,
    };
}

function completedEvaluation(questionIds: readonly string[]): Response {
    return Response.json({
        model: 'jev-1.13.0',
        answers: Object.fromEntries(
            questionIds.map(id => [
                id,
                {
                    type: 'score',
                    score: 2,
                    legend: { '0': 'Different', '1': 'Possible', '2': 'Strong' },
                    confidence: 1,
                    probabilities: { '0': 0, '1': 0, '2': 1 },
                },
            ])
        ),
        usage: { input_tokens: 100, output_tokens: 10 },
    });
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
    return app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('authenticated workflow routes', () => {
    it('blocks viewers before AI inference', async () => {
        let aiCalled = false;
        const book = { getPermission: () => Permission.VIEWER } as unknown as Book;
        const app = createApp(
            contextWithBook(book, async () => {
                aiCalled = true;
                return Response.json({});
            })
        );

        const response = await post(app, '/api/v1/analyze', {
            bookId: 'book',
            transactions: [transaction('first'), transaction('second')],
        });

        expect(response.status).toBe(403);
        expect(aiCalled).toBe(false);
    });

    it('rejects missing, non-canonical, and duplicate transaction IDs', async () => {
        const book = { getPermission: () => Permission.OWNER } as unknown as Book;
        const app = createApp(contextWithBook(book));

        for (const transactions of [
            [transaction('first'), transaction('second', { id: undefined })],
            [transaction(' first '), transaction('second')],
            [transaction('same'), transaction('same')],
        ]) {
            const response = await post(app, '/api/v1/analyze', { bookId: 'book', transactions });
            expect(response.status).toBe(400);
        }
    });

    it('rejects more than one thousand submitted transactions', async () => {
        const book = { getPermission: () => Permission.OWNER } as unknown as Book;
        const app = createApp(contextWithBook(book));
        const transactions = Array.from({ length: 1_001 }, (_, index) =>
            transaction(`transaction-${index}`)
        );

        const response = await post(app, '/api/v1/analyze', { bookId: 'book', transactions });

        expect(response.status).toBe(400);
    });

    it('counts malformed date and amount rows as invalid and filters checked, trashed, and locked rows', async () => {
        const book = {
            getPermission: () => Permission.OWNER,
            getLockDate: () => '2026-08-01',
            getClosingDate: () => undefined,
        } as unknown as Book;
        const app = createApp(contextWithBook(book));

        const response = await post(app, '/api/v1/analyze', {
            bookId: 'book',
            transactions: [
                transaction('valid'),
                transaction('checked', { checked: true }),
                transaction('trashed', { trashed: true, checked: true }),
                transaction('locked', { date: '2026-08-01' }),
                transaction('bad-date', { date: '2026-02-30' }),
                transaction('bad-amount', { amount: 'not-an-amount' }),
            ],
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            suggestions: [],
            skipped: { total: 5, checked: 1, trashed: 1, locked: 1, invalid: 2 },
        });
    });

    it('preserves safe Bkper AI status and code in API errors', async () => {
        const book = {
            getPermission: () => Permission.OWNER,
            getLockDate: () => undefined,
            getClosingDate: () => undefined,
            getProperty: () => undefined,
            getAccount: async () => undefined,
        } as unknown as Book;
        const app = createApp(
            contextWithBook(book, async () =>
                Response.json(
                    {
                        error: {
                            code: 'usage_limit_exceeded',
                            message: 'AI allowance exhausted.',
                        },
                    },
                    { status: 429 }
                )
            )
        );

        const response = await post(app, '/api/v1/analyze', {
            bookId: 'book',
            transactions: [transaction('first'), transaction('second')],
        });

        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({
            success: false,
            error: { code: 'usage_limit_exceeded', message: 'AI allowance exhausted.' },
        });
    });

    it('preserves evaluation-provider overload details as a gateway error', async () => {
        const book = {
            getPermission: () => Permission.OWNER,
            getLockDate: () => undefined,
            getClosingDate: () => undefined,
            getProperty: () => undefined,
            getAccount: async () => undefined,
        } as unknown as Book;
        const app = createApp(
            contextWithBook(book, async () =>
                Response.json(
                    {
                        error: {
                            code: 'provider_overloaded',
                            message: 'Evaluation provider overloaded.',
                        },
                    },
                    { status: 503 }
                )
            )
        );

        const response = await post(app, '/api/v1/analyze', {
            bookId: 'book',
            transactions: [transaction('first'), transaction('second')],
        });

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
            success: false,
            error: {
                code: 'provider_overloaded',
                message: 'Evaluation provider overloaded.',
            },
        });
    });

    it('sends only minimized candidates to AI and maps suggestions to unchanged full payloads', async () => {
        const first = transaction('first', {
            remoteIds: ['private-remote-id'],
            tags: ['private-tag'],
            urls: ['https://private.example'],
        });
        const second = transaction('second', {
            date: '2026-08-04',
            description: 'Transaction second',
            files: [{ id: 'private-file', name: 'receipt.pdf' }],
        });
        const book = {
            getPermission: () => Permission.OWNER,
            getLockDate: () => undefined,
            getClosingDate: () => undefined,
            getProperty: () => undefined,
            getAccount: async () => undefined,
        } as unknown as Book;
        let aiTransactions: Array<Record<string, unknown>> = [];
        const aiFetch = async (input: RequestInfo | URL) => {
            const request = input instanceof Request ? input : new Request(input);
            const body = (await request.json()) as {
                questions: Record<
                    string,
                    { instructions: { transactions: Array<Record<string, unknown>> } }
                >;
            };
            aiTransactions = Object.values(body.questions)[0]?.instructions.transactions ?? [];
            return completedEvaluation(Object.keys(body.questions));
        };
        const app = createApp(contextWithBook(book, aiFetch));

        const response = await post(app, '/api/v1/analyze', {
            bookId: 'book',
            transactions: [first, second],
        });
        const body = (await response.json()) as {
            suggestions: Array<{ transactions: bkper.Transaction[] }>;
        };

        expect(response.status).toBe(200);
        expect(aiTransactions).toHaveLength(2);
        expect(aiTransactions[0]).not.toHaveProperty('id');
        expect(aiTransactions[0]).not.toHaveProperty('remoteIds');
        expect(aiTransactions[0]).not.toHaveProperty('tags');
        expect(aiTransactions[1]).not.toHaveProperty('files');
        expect(body.suggestions).toEqual([
            {
                transactions: [first, second],
                strength: 'Strong',
                explanation: 'Same From Account: Bank · 1 day apart',
            },
        ]);
    });

    it('logs payload-free analysis and Jev efficiency metrics', async () => {
        const events: Array<{ event: string; metrics: Record<string, string | number | boolean> }> =
            [];
        const performanceMonitor: PerformanceMonitor = {
            now: () => performance.now(),
            log: (event, metrics) => events.push({ event, metrics: { ...metrics } }),
        };
        const book = {
            getPermission: () => Permission.OWNER,
            getLockDate: () => undefined,
            getClosingDate: () => undefined,
            getProperty: () => undefined,
            getAccount: async () => undefined,
        } as unknown as Book;
        const aiFetch = async (input: RequestInfo | URL) => {
            const request = input instanceof Request ? input : new Request(input);
            const body = (await request.json()) as { questions: Record<string, unknown> };
            return completedEvaluation(Object.keys(body.questions));
        };
        const app = createApp(contextWithBook(book, aiFetch, performanceMonitor));

        const response = await post(app, '/api/v1/analyze', {
            bookId: 'book',
            transactions: [
                transaction('private-first', { description: 'DO_NOT_LOG_FIRST' }),
                transaction('private-second', { description: 'DO_NOT_LOG_SECOND' }),
            ],
        });

        expect(response.status).toBe(200);
        expect(events.map(item => item.event)).toEqual([
            'analysis.started',
            'jev.batch.completed',
            'analysis.completed',
        ]);
        expect(events[1]?.metrics).toMatchObject({ batch: 1, batches: 1, questions: 1 });
        expect(events[2]?.metrics).toMatchObject({
            submittedTransactions: 2,
            eligibleTransactions: 2,
            skippedTransactions: 0,
            candidateTransactions: 2,
            candidatePairs: 1,
            learningExamples: 0,
            jevBatches: 1,
            suggestions: 1,
        });
        expect(JSON.stringify(events)).not.toContain('private-first');
        expect(JSON.stringify(events)).not.toContain('DO_NOT_LOG_FIRST');
    });

    it('passes merge payload overrides directly to the canonical Book operation and returns its full payload', async () => {
        const calls: bkper.Transaction[][] = [];
        const merged = transaction('canonical-transaction', { description: 'Canonical result' });
        const book = {
            getPermission: () => Permission.POSTER,
            mergeTransactions: async (primary: bkper.Transaction, secondary: bkper.Transaction) => {
                calls.push([primary, secondary]);
                return { json: () => merged } as Transaction;
            },
        } as unknown as Book;
        const app = createApp(contextWithBook(book));
        const primary = { id: 'first', description: 'Preferred description' };
        const secondary = { id: 'second', properties: { source: 'bank' } };

        const response = await post(app, '/api/v1/merge', {
            bookId: 'book',
            primary,
            secondary,
        });

        expect(response.status).toBe(200);
        expect(calls).toEqual([[primary, secondary]]);
        expect(await response.json()).toEqual(merged);
    });

    it('validates learning context, pair cardinality, IDs, and batch size', async () => {
        const book = { getPermission: () => Permission.OWNER } as unknown as Book;
        const app = createApp(contextWithBook(book));
        const pair = [transaction('first'), transaction('second')];
        const invalidRequests = [
            { bookId: 'book', accountId: 'account', groupId: 'group', examples: [pair] },
            { bookId: 'book', examples: [] },
            { bookId: 'book', examples: Array.from({ length: 51 }, () => pair) },
            { bookId: 'book', examples: [[transaction('first')]] },
            {
                bookId: 'book',
                examples: [[transaction('first'), transaction('missing', { id: undefined })]],
            },
        ];

        for (const request of invalidRequests) {
            const response = await post(app, '/api/v1/learn', request);
            expect(response.status).toBe(400);
        }
    });

    it('returns a typed 403 when a Post collaborator calls learning directly', async () => {
        const book = { getPermission: () => Permission.POSTER } as unknown as Book;
        const app = createApp(contextWithBook(book));

        const response = await post(app, '/api/v1/learn', {
            bookId: 'book',
            examples: [[transaction('first'), transaction('second')]],
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            success: false,
            error: {
                code: 'REQUEST_FAILED',
                message: 'Learning requires OWNER or EDITOR permission. Current: POSTER.',
            },
        });
    });
});
