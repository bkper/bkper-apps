import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/index.js';

const subscribedEvents = [
    'TRANSACTION_POSTED',
    'TRANSACTION_CHECKED',
    'TRANSACTION_UNCHECKED',
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
    ASSETS: { fetch: async () => new Response('asset') },
};

describe('Cloudflare skeleton', () => {
    it('does not expose a standalone health endpoint', async () => {
        const response = await createApp().request('/health', {}, env);

        expect(await response.text()).toBe('asset');
    });

    it('keeps all subscribed Portfolio Bot events as no-ops', async () => {
        const app = createApp();

        for (const type of subscribedEvents) {
            const response = await app.request(
                '/events',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ type }),
                },
                env
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('application/json');
            expect(await response.json()).toEqual({ result: false });
        }
    });

    it('returns the standard JSON error for unknown API routes', async () => {
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
