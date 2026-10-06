import { Bkper } from 'bkper-js';
import { Hono } from 'hono';
import { AppContext } from '../AppContext.js';
import { discoverItems } from './discovery.js';
import { openApiDocument } from './openapi.js';
import { DiscoveryBatchSchema, DiscoveryItemSchema } from './schemas.js';

export function registerApiRoutes(app: Hono): void {
    app.get('/openapi.json', c => c.json(openApiDocument));

    app.post('/api/v1/discovery', async c => {
        const body: unknown = await c.req.json().catch(() => undefined);
        const parsed = DiscoveryItemSchema.safeParse(body);
        if (!parsed.success) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid discovery item.' } }, 400);
        // The SDK requires an API-key value; this is a placeholder, not a caller token.
        // Platform outbound supplies verified authorization and Bookbot attribution.
        const context = new AppContext(new Bkper(), c.env as Env, 'bkper-platform-outbound', c.req.raw.signal);
        const results = await discoverItems([parsed.data], context, c.req.raw.signal);
        return c.json(results[0]);
    });

    app.post('/api/v1/discovery/batch', async c => {
        const body: unknown = await c.req.json().catch(() => undefined);
        const parsed = DiscoveryBatchSchema.safeParse(body);
        if (!parsed.success) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid batch or duplicate item identifiers.' } }, 400);
        const context = new AppContext(new Bkper(), c.env as Env, 'bkper-platform-outbound', c.req.raw.signal);
        return c.json({ items: await discoverItems(parsed.data.items, context, c.req.raw.signal) });
    });
}
