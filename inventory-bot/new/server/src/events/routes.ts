import type { Hono } from 'hono';
import type { Env } from '../../../env.js';
import type { EventResult } from '../shared/types.js';

type App = Hono<{ Bindings: Env }>;

const LEGACY_EVENT_TYPES = new Set([
    'TRANSACTION_CHECKED',
    'TRANSACTION_UNCHECKED',
    'TRANSACTION_POSTED',
    'TRANSACTION_DELETED',
]);

export function registerEventRoutes(app: App): void {
    app.get('/events', c => c.json({ status: 'ok' }));

    app.post('/events', async c => {
        try {
            const event: bkper.Event = await c.req.json();

            if (!event.book) {
                return c.json({ error: 'Missing book in event payload' }, 400);
            }

            return c.json(dispatchEvent(event));
        } catch (err: unknown) {
            console.error(err);
            const error = err instanceof Error ? err.message : 'Unknown error';
            return c.json({ error });
        }
    });
}

function dispatchEvent(event: bkper.Event): EventResult {
    if (event.type && LEGACY_EVENT_TYPES.has(event.type)) {
        return { result: false };
    }

    return { result: false };
}
