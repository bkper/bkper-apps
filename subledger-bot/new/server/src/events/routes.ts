import type { Hono } from 'hono';
import type { Env } from '../../../env.js';

type App = Hono<{ Bindings: Env }>;

export function registerEventRoutes(app: App): void {
    app.post('/events', async c => {
        const event: bkper.Event = await c.req.json();

        return c.json(handleEvent(event));
    });
}

function handleEvent(_event: bkper.Event): { result: false } {
    return { result: false };
}
