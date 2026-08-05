import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/index.js';

const subscribedEvents = [
    'TRANSACTION_POSTED',
    'TRANSACTION_CHECKED',
    'TRANSACTION_UPDATED',
    'TRANSACTION_DELETED',
    'TRANSACTION_RESTORED',
    'ACCOUNT_CREATED',
    'ACCOUNT_UPDATED',
    'ACCOUNT_DELETED',
    'GROUP_CREATED',
    'GROUP_UPDATED',
    'GROUP_DELETED',
    'BOOK_UPDATED',
] as const;

const env = {
    OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
    ASSETS: { fetch: async () => new Response('asset') },
};

describe('Cloudflare skeleton', () => {
    it('serves health', async () => {
        const response = await createApp().request('/health', {}, env);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('keeps subscribed events as no-ops', async () => {
        const app = createApp();

        for (const type of subscribedEvents) {
            const response = await app.request(
                '/events',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        type,
                        user: { username: 'tester' },
                        book: {
                            id: 'book-1',
                            name: 'Test Book',
                            properties: { exc_code: 'USD' },
                        },
                        data: {
                            object: {
                                transaction: {
                                    checked: true,
                                    date: '2026-01-02',
                                    properties: {},
                                },
                            },
                        },
                    }),
                },
                env
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ result: false });
        }
    });

    it('returns JSON for unknown API routes', async () => {
        const response = await createApp().request('/api/v1/missing', {}, env);

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: { message: 'Route not found: GET /api/v1/missing' },
        });
    });

    it('falls back to static assets outside API routes', async () => {
        const response = await createApp().request('/menu', {}, env);

        expect(await response.text()).toBe('asset');
    });
});
