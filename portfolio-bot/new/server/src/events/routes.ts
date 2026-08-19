import { Bkper } from 'bkper-js';
import type { Hono } from 'hono';
import type { Env } from '../../../env.js';
import { AppContext } from '../shared/app-context.js';
import { EventHandlerAccountCreatedOrUpdated } from './handlers/EventHandlerAccountCreatedOrUpdated.js';
import { EventHandlerAccountDeleted } from './handlers/EventHandlerAccountDeleted.js';
import { EventHandlerBookUpdated } from './handlers/EventHandlerBookUpdated.js';
import { EventHandlerGroupCreatedOrUpdated } from './handlers/EventHandlerGroupCreatedOrUpdated.js';
import { EventHandlerGroupDeleted } from './handlers/EventHandlerGroupDeleted.js';
import { EventHandlerTransactionChecked } from './handlers/EventHandlerTransactionChecked.js';
import { EventHandlerTransactionDeleted } from './handlers/EventHandlerTransactionDeleted.js';
import { EventHandlerTransactionPosted } from './handlers/EventHandlerTransactionPosted.js';
import { EventHandlerTransactionRestored } from './handlers/EventHandlerTransactionRestored.js';
import { EventHandlerTransactionUnchecked } from './handlers/EventHandlerTransactionUnchecked.js';
import { EventHandlerTransactionUpdated } from './handlers/EventHandlerTransactionUpdated.js';
import type { EventError, EventResult } from './types.js';

type App = Hono<{ Bindings: Env }>;

export function registerEventRoutes(app: App): void {
    app.post('/events', async c => {
        const context = new AppContext(new Bkper(), c.env);

        try {
            const event: bkper.Event = await c.req.json();
            let result: EventResult = { result: false };

            switch (event.type) {
                case 'TRANSACTION_POSTED':
                    result = await new EventHandlerTransactionPosted(context).handleEvent(event);
                    break;
                case 'TRANSACTION_CHECKED':
                    result = await new EventHandlerTransactionChecked(context).handleEvent(event);
                    break;
                case 'TRANSACTION_UNCHECKED':
                    result = await new EventHandlerTransactionUnchecked(context).handleEvent(event);
                    break;
                case 'TRANSACTION_UPDATED':
                    result = await new EventHandlerTransactionUpdated(context).handleEvent(event);
                    break;
                case 'TRANSACTION_DELETED':
                    result = await new EventHandlerTransactionDeleted(context).handleEvent(event);
                    break;
                case 'TRANSACTION_RESTORED':
                    result = await new EventHandlerTransactionRestored(context).handleEvent(event);
                    break;
                case 'ACCOUNT_CREATED':
                    result = await new EventHandlerAccountCreatedOrUpdated(context).handleEvent(
                        event
                    );
                    break;
                case 'ACCOUNT_UPDATED':
                    result = await new EventHandlerAccountCreatedOrUpdated(context).handleEvent(
                        event
                    );
                    break;
                case 'ACCOUNT_DELETED':
                    result = await new EventHandlerAccountDeleted(context).handleEvent(event);
                    break;
                case 'GROUP_CREATED':
                    result = await new EventHandlerGroupCreatedOrUpdated(context).handleEvent(
                        event
                    );
                    break;
                case 'GROUP_UPDATED':
                    result = await new EventHandlerGroupCreatedOrUpdated(context).handleEvent(
                        event
                    );
                    break;
                case 'GROUP_DELETED':
                    result = await new EventHandlerGroupDeleted(context).handleEvent(event);
                    break;
                case 'BOOK_UPDATED':
                    result = await new EventHandlerBookUpdated(context).handleEvent(event);
                    break;
            }

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
