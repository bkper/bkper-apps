import { Bkper } from 'bkper-js';
import type { Hono } from 'hono';
import type { Env } from '../../../env.js';
import { AppContext } from '../shared/app-context.js';
import type { EventError, EventResult } from './types.js';

type App = Hono<{ Bindings: Env }>;

export function registerEventRoutes(app: App): void {
    app.post('/events', async c => {
        const context = new AppContext(new Bkper(), c.env);

        try {
            const event: bkper.Event = await c.req.json();
            const result: EventResult = { result: false };

            console.log(`Result: ${JSON.stringify(result)}`);
            return c.body(response(result), 200, { 'Content-Type': 'application/json' });
        } catch (error: unknown) {
            console.error(error);
            const result: EventError = { error: getLegacyError(error) };
            return c.body(response(result), 200, { 'Content-Type': 'application/json' });
        }
    });
}

function getLegacyError(error: unknown): unknown {
    if (
        typeof error === 'object' &&
        error !== null &&
        'stack' in error &&
        typeof error.stack === 'string' &&
        error.stack
    ) {
        return error.stack.split('\n');
    }
    return error;
}

function response(result: EventResult | EventError): string {
    return JSON.stringify(result, null, 4);
}
