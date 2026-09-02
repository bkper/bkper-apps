import type { Hono } from 'hono';
import type { Env } from '../../../env.js';
import type { EventResult } from './types.js';

type App = Hono<{ Bindings: Env }>;

export function registerEventRoutes(app: App): void {
    app.post('/events', c => {
        const result: EventResult = { result: false };
        return c.json(result);
    });
}
