import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../../env.js';
import { registerEventRoutes } from '../../src/events/routes.js';

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};

describe('event stub', () => {
    it('returns the non-mutating no-op response without parsing or dispatching the body', async () => {
        const app = new Hono<{ Bindings: Env }>();
        registerEventRoutes(app);

        const response = await app.request(
            '/events',
            { method: 'POST', body: 'not an event' },
            env
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ result: false });
    });
});
