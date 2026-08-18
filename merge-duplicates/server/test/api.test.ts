import { describe, expect, it } from 'bun:test';
import { Permission, type Bkper, type Book, type Transaction } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { createApp } from '../src/index';
import { BkperAiError } from '../src/services/bkper-ai-service';

function contextWithBook(book: Book, aiFetch: typeof fetch = fetch) {
    const bkper = { getBook: async () => book } as unknown as Bkper;
    return () => new AppContext(bkper, { ASSETS: { fetch } }, aiFetch);
}

describe('authenticated workflow routes', () => {
    it('blocks viewers before listing transactions or calling AI', async () => {
        let listed = false;
        let aiCalled = false;
        const book = {
            getPermission: () => Permission.VIEWER,
            listTransactions: async () => {
                listed = true;
                throw new Error('must not list');
            },
        } as unknown as Book;
        const app = createApp(
            contextWithBook(book, async () => {
                aiCalled = true;
                return Response.json({});
            })
        );

        const response = await app.request('/api/v1/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bookId: 'book', query: '', fingerprints: [] }),
        });

        expect(response.status).toBe(403);
        expect(listed).toBe(false);
        expect(aiCalled).toBe(false);
    });

    it('preserves safe Bkper AI status and code in API errors', async () => {
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async () => {
                throw new BkperAiError(429, 'usage_limit_exceeded', 'AI allowance exhausted.');
            },
        } as unknown as Book;
        const app = createApp(contextWithBook(book));

        const response = await app.request('/api/v1/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bookId: 'book', query: '', fingerprints: [] }),
        });

        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({
            success: false,
            error: { code: 'usage_limit_exceeded', message: 'AI allowance exhausted.' },
        });
    });

    it('returns Book-formatted values and Account types for familiar transaction rows', async () => {
        const transaction = {
            id: 'transaction',
            date: '2026-08-03',
            dateFormatted: '03/08/2026',
            amount: '763.01',
            description: 'PREAUTHORIZED CREDIT',
            posted: false,
            creditAccount: { id: 'bank', name: '' },
            properties: {},
        };
        const book = {
            getPermission: () => Permission.OWNER,
            getLockDate: () => undefined,
            getClosingDate: () => undefined,
            getAccounts: async () => [
                { getId: () => 'bank', getName: () => 'Safra', getType: () => 'ASSET' },
            ],
            formatValue: () => '763,01',
            listTransactions: async () => ({
                getItems: () => [{ json: () => transaction }],
                getCursor: () => undefined,
            }),
        } as unknown as Book;
        const app = createApp(contextWithBook(book));

        const response = await app.request('/api/v1/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bookId: 'book', query: '', fingerprints: [] }),
        });
        const body = (await response.json()) as {
            fingerprints: Array<{
                dateFormatted?: string;
                amountFormatted?: string;
                fromAccount: { name: string; type?: string } | null;
            }>;
        };

        expect(response.status).toBe(200);
        expect(body.fingerprints[0]).toMatchObject({
            dateFormatted: '03/08/2026',
            amountFormatted: '763,01',
            fromAccount: { name: 'Safra', type: 'ASSET' },
        });
    });

    it('uses the canonical one-pair Book merge operation', async () => {
        const calls: string[][] = [];
        const book = {
            getPermission: () => Permission.POSTER,
            mergeTransactions: async (first: string, second: string) => {
                calls.push([first, second]);
                return { getId: () => 'canonical-transaction' } as Transaction;
            },
        } as unknown as Book;
        const app = createApp(contextWithBook(book));

        const response = await app.request('/api/v1/merge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                bookId: 'book',
                firstTransactionId: 'first',
                secondTransactionId: 'second',
            }),
        });

        expect(response.status).toBe(200);
        expect(calls).toEqual([['first', 'second']]);
        expect(await response.json()).toEqual({ mergedTransactionId: 'canonical-transaction' });
    });
});
