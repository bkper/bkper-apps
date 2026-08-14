import type { Hono } from 'hono';
import { Bkper } from 'bkper-js';
import type { Env } from '../../../env.js';
import { AppContext } from '../AppContext.js';
import EventHandlerTransactionDeleted from './handlers/EventHandlerTransactionDeleted.js';
import EventHandlerTransactionPosted from './handlers/EventHandlerTransactionPosted.js';
import EventHandlerTransactionUpdated from './handlers/EventHandlerTransactionUpdated.js';
import type { EventError, EventResult } from './types.js';

type App = Hono<{ Bindings: Env }>;

export function registerEventRoutes(app: App): void {
    app.post('/events', async c => {
        const context = new AppContext(new Bkper());

        try {
            const event: bkper.Event = await c.req.json();
            const result: EventResult = { result: false };

            console.log(`Received ${event.type} event from ${event?.user?.username}...`);

            switch (event.type) {
                case 'TRANSACTION_POSTED':
                    result.result = await new EventHandlerTransactionPosted(context).handleEvent(
                        event
                    );
                    break;
                case 'TRANSACTION_DELETED':
                    result.result = await new EventHandlerTransactionDeleted(context).handleEvent(
                        event
                    );
                    break;
                case 'TRANSACTION_RESTORED':
                    result.result = await new EventHandlerTransactionPosted(context).handleEvent(
                        event
                    );
                    break;
                case 'TRANSACTION_UPDATED':
                    result.result = await new EventHandlerTransactionUpdated(context).handleEvent(
                        event
                    );
                    break;
            }

            console.log(`Result: ${JSON.stringify(result)}`);
            return c.body(response(result), 200, { 'Content-Type': 'application/json' });
        } catch (err: unknown) {
            console.error(err);
            const result: EventError = { error: getLegacyError(err) };
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
