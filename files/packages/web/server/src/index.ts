import { Hono } from 'hono';
import type { Env } from '../../../../env.js';

const app = new Hono<{ Bindings: Env }>();

// SPA fallback: serve index.html for all book file preview routes
app.get('/books/*', async c => {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url, c.req));
});

// Health check
app.get('/health', c => c.json({ status: 'ok' }));

export default app;
