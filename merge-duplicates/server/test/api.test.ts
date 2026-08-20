import { describe, expect, it } from 'bun:test';
import { Permission, type Bkper, type Book, type Transaction } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { createApp } from '../src/index';

function contextWithBook(book: Book, aiFetch: typeof fetch = fetch) {
    const bkper = { getBook: async () => book } as unknown as Bkper;
    return () => new AppContext(bkper, { ASSETS: { fetch } }, aiFetch);
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

function completedAnalysis(firstIndex = 0, secondIndex = 1): Response {
    return Response.json({
        status: 'completed',
        output: [
            {
                type: 'message',
                content: [
                    {
                        type: 'output_text',
                        text: JSON.stringify({
                            pairs: [
                                {
                                    firstIndex,
                                    secondIndex,
                                    strength: 'Strong',
                                    explanation: 'Same movement.',
                                },
                            ],
                        }),
                    },
                ],
            },
        ],
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
                input: Array<{ content: Array<{ text: string }> }>;
            };
            const payload = JSON.parse(body.input[0]?.content[0]?.text ?? '{}') as {
                candidateTransactions?: Array<Record<string, unknown>>;
            };
            aiTransactions = payload.candidateTransactions ?? [];
            return completedAnalysis();
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
                explanation: 'Same movement.',
            },
        ]);
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
