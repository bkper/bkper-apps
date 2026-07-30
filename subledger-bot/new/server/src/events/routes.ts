import type { Hono } from 'hono';
import type { Env } from '../../../env.js';
import { createAppContext, type AppContextFactory } from '../app-context.js';
import { createEventHandlerMap, type EventHandlerMapFactory } from './handlers/index.js';
import type { EventError, EventHandlerMap, EventHandlerResult, EventResult } from './types.js';

type App = Hono<{ Bindings: Env }>;

export interface EventRouteDependencies {
    createContext: AppContextFactory;
    createHandlers: EventHandlerMapFactory;
}

export const defaultEventRouteDependencies: EventRouteDependencies = {
    createContext: createAppContext,
    createHandlers: createEventHandlerMap,
};

export function registerEventRoutes(
    app: App,
    dependencies: EventRouteDependencies = defaultEventRouteDependencies
): void {
    app.post('/events', async c => {
        try {
            const event: bkper.Event = await c.req.json();
            const context = dependencies.createContext();
            const handlers = dependencies.createHandlers(context);

            console.log(`Received ${event.type} event from ${event.user!.username}...`);

            const result = await dispatchEvent(event, handlers);
            const response: EventResult = { result };

            console.log(`Result: ${JSON.stringify(response)}`);

            return c.body(serializeLegacyResponse(response), 200, {
                'Content-Type': 'application/json',
            });
        } catch (error: unknown) {
            console.error(error);
            const response: EventError = { error: getLegacyError(error) };

            return c.body(serializeLegacyResponse(response), 200, {
                'Content-Type': 'application/json',
            });
        }
    });
}

async function dispatchEvent(
    event: bkper.Event,
    handlers: EventHandlerMap
): Promise<EventHandlerResult> {
    switch (event.type) {
        case 'TRANSACTION_POSTED':
            return handlers.TRANSACTION_POSTED.handleEvent(event);
        case 'TRANSACTION_CHECKED':
            return handlers.TRANSACTION_CHECKED.handleEvent(event);
        case 'TRANSACTION_UPDATED':
            return handlers.TRANSACTION_UPDATED.handleEvent(event);
        case 'TRANSACTION_DELETED':
            return handlers.TRANSACTION_DELETED.handleEvent(event);
        case 'TRANSACTION_RESTORED':
            return handlers.TRANSACTION_RESTORED.handleEvent(event);
        case 'ACCOUNT_CREATED':
            return handlers.ACCOUNT_CREATED.handleEvent(event);
        case 'ACCOUNT_UPDATED':
            return handlers.ACCOUNT_UPDATED.handleEvent(event);
        case 'ACCOUNT_DELETED':
            return handlers.ACCOUNT_DELETED.handleEvent(event);
        case 'GROUP_CREATED':
            return handlers.GROUP_CREATED.handleEvent(event);
        case 'GROUP_UPDATED':
            return handlers.GROUP_UPDATED.handleEvent(event);
        case 'GROUP_DELETED':
            return handlers.GROUP_DELETED.handleEvent(event);
        default:
            return false;
    }
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

function serializeLegacyResponse(response: EventResult | EventError): string {
    return JSON.stringify(response, null, 4);
}
