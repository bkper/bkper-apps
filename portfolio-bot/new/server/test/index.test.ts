import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/index.js';

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};

describe('Cloudflare skeleton', () => {
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
