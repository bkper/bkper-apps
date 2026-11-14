import { Bkper } from 'bkper-js';
import { Context, Hono } from 'hono';
import { AppContext } from '../AppContext.js';
import { discoverItems } from './discovery.js';
import { openApiDocument } from './openapi.js';
import { CompletionBatchSchema, CompletionItemSchema } from './schemas.js';

export function registerApiRoutes(app: Hono): void {
    app.get('/openapi.json', c => c.json(openApiDocument));

    // The /discovery paths are the earlier names, kept working for existing callers and left out of /openapi.json.
    app.post('/api/v1/complete', complete);
    app.post('/api/v1/discovery', complete);
    app.post('/api/v1/complete/batch', completeBatch);
    app.post('/api/v1/discovery/batch', completeBatch);
}

async function complete(c: Context) {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = CompletionItemSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid completion item.' } }, 400);
    const results = await discoverItems([parsed.data], createContext(c), c.req.raw.signal);
    return c.json(results[0]);
}

async function completeBatch(c: Context) {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = CompletionBatchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid batch or duplicate item identifiers.' } }, 400);
    return c.json({ items: await discoverItems(parsed.data.items, createContext(c), c.req.raw.signal) });
}

function createContext(c: Context): AppContext {
    // The SDK requires an API-key value; this is a placeholder, not a caller token.
    // Platform outbound supplies verified authorization and Bookbot attribution.
    return new AppContext(new Bkper(), c.env as Env, 'bkper-platform-outbound', c.req.raw.signal);
}
