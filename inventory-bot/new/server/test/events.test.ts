import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('inventory bot event route', () => {
    test('returns a no-op result for declared legacy events during client-first migration', async () => {
        const response = await app.request('/events', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'bkper-oauth-token': 'legacy-token-should-not-be-read',
                'bkper-agent-id': 'legacy-agent-should-not-be-read',
            },
            body: JSON.stringify({
                type: 'TRANSACTION_CHECKED',
                book: { id: 'book-1', name: 'Financial Book' },
                data: {
                    object: {
                        transaction: {
                            id: 'tx-1',
                            posted: true,
                            amount: '100',
                            date: '2026-05-29',
                            description: 'Sale',
                        },
                    },
                },
            }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ result: false });
    });

    test('returns a clear error when the event payload has no book', async () => {
        const response = await app.request('/events', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'TRANSACTION_CHECKED' }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Missing book in event payload' });
    });
});
