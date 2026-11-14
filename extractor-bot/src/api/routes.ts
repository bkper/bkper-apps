import { Bkper } from 'bkper-js';
import { Context, Hono } from 'hono';
import { AppContext } from '../AppContext.js';
import { openApiDocument } from './openapi.js';
import { parse } from './parse.js';
import { ExtractRequestSchema } from './schemas.js';

export function registerApiRoutes(app: Hono): void {
    app.get('/openapi.json', c => c.json(openApiDocument));
    // /parse is the earlier name, kept working for existing callers and left out of /openapi.json.
    app.post('/api/v1/extract', extract);
    app.post('/api/v1/parse', extract);
}

async function extract(c: Context) {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = ExtractRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid extract request.' } }, 400);
    // Platform validates bearer authentication and supplies outbound authorization.
    // This SDK placeholder is not a caller token; legacy event authentication is unchanged.
    const context = new AppContext(new Bkper(), c.env as Env, 'bkper-platform-outbound', c.req.raw.signal, true);
    return c.json(await parse(parsed.data, context, c.req.raw.signal));
}
