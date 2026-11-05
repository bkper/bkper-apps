import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { appContextMiddleware, type AppEnv } from '../src/app-context';
import { createTestEnv } from './test-env';

function createTestApp() {
    const app = new Hono<AppEnv>();
    app.use('/api/*', appContextMiddleware());
    app.get('/api/measured', async c => {
        await c.var.appContext.timing.measure('kv', async () => undefined);
        return c.json({ ok: true });
    });
    app.get('/api/plain', c => c.json({ ok: true }));
    return app;
}

describe('appContextMiddleware', () => {
    it('reports what the request measured in the Server-Timing header', async () => {
        const response = await createTestApp().request('/api/measured', {}, createTestEnv());
        expect(response.headers.get('Server-Timing')).toMatch(/^kv;dur=[\d.]+$/);
    });

    it('adds no Server-Timing header when nothing was measured', async () => {
        const response = await createTestApp().request('/api/plain', {}, createTestEnv());
        expect(response.headers.get('Server-Timing')).toBeNull();
    });

    it('runs deferred work with waitUntil when the runtime has an execution context', async () => {
        const app = new Hono<AppEnv>();
        app.use('/api/*', appContextMiddleware());
        app.get('/api/deferred', c => {
            c.var.appContext.defer?.(Promise.resolve('stored'));
            return c.json({ hasDefer: c.var.appContext.defer !== undefined });
        });
        const waited: Promise<unknown>[] = [];
        const executionCtx = {
            waitUntil: (task: Promise<unknown>) => waited.push(task),
            passThroughOnException: () => undefined,
            props: {},
        };
        const withContext = await app.request('/api/deferred', {}, createTestEnv(), executionCtx);
        expect(await withContext.json()).toEqual({ hasDefer: true });
        expect(waited).toHaveLength(1);

        const without = await app.request('/api/deferred', {}, createTestEnv());
        expect(await without.json()).toEqual({ hasDefer: false });
    });
});
