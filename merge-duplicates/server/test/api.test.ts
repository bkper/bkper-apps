import { describe, expect, it } from 'bun:test';
import { Permission, type Bkper, type Book, type Transaction } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { createApp } from '../src/index';

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
