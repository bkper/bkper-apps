import { describe, expect, it, spyOn } from 'bun:test';
import { BkperError } from 'bkper-js';
import { createApp } from '../src/index.js';
import { ResetService } from '../src/api/services/reset-service.js';

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};

describe('Cloudflare skeleton', () => {
    it.each([401, 403])('preserves Core authentication status %i', async status => {
        const reset = spyOn(ResetService, 'execute').mockRejectedValue(
            new BkperError(status, 'Login Required.')
        );
        try {
            const response = await createApp().request(
                '/api/v1/books/book-1/accounts/account-1/reset',
                { method: 'POST' },
                env
            );

            expect(response.status).toBe(status);
            expect(await response.json()).toEqual({ error: { message: 'Login Required.' } });
        } finally {
            reset.mockRestore();
        }
    });

    it('does not expose a standalone health endpoint', async () => {
        const response = await createApp().request('/health', {}, env);

        expect(await response.text()).toBe('asset');
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
