import { describe, expect, test } from 'bun:test';
import { Bkper } from 'bkper-js';
import { AppContext, createAppContext } from '../src/app-context';
import type { EventRouteDependencies } from '../src/events/routes';
import {
    SUBSCRIBED_EVENT_TYPES,
    type EventHandlerContract,
    type EventHandlerMap,
    type SubscribedEventType,
} from '../src/events/types';
import { createApp } from '../src/index';

interface RoutingCase {
    type: SubscribedEventType;
    result: string;
}

const ROUTING_CASES: readonly RoutingCase[] = [
    { type: 'TRANSACTION_POSTED', result: 'transaction-posted' },
    { type: 'TRANSACTION_CHECKED', result: 'transaction-checked' },
    { type: 'TRANSACTION_UPDATED', result: 'transaction-updated' },
    { type: 'TRANSACTION_DELETED', result: 'transaction-deleted' },
    { type: 'TRANSACTION_RESTORED', result: 'transaction-restored' },
    { type: 'ACCOUNT_CREATED', result: 'account-created-or-updated' },
    { type: 'ACCOUNT_UPDATED', result: 'account-created-or-updated' },
    { type: 'ACCOUNT_DELETED', result: 'account-deleted' },
    { type: 'GROUP_CREATED', result: 'group-created-or-updated' },
    { type: 'GROUP_UPDATED', result: 'group-created-or-updated' },
    { type: 'GROUP_DELETED', result: 'group-deleted' },
];

function createHandler(result: string): EventHandlerContract {
    return {
        handleEvent: async () => result,
    };
}

function createTestHandlers(overrides: Partial<EventHandlerMap> = {}): EventHandlerMap {
    const accountCreatedOrUpdated = createHandler('account-created-or-updated');
    const groupCreatedOrUpdated = createHandler('group-created-or-updated');

    return {
        TRANSACTION_POSTED: createHandler('transaction-posted'),
        TRANSACTION_CHECKED: createHandler('transaction-checked'),
        TRANSACTION_UPDATED: createHandler('transaction-updated'),
        TRANSACTION_DELETED: createHandler('transaction-deleted'),
        TRANSACTION_RESTORED: createHandler('transaction-restored'),
        ACCOUNT_CREATED: accountCreatedOrUpdated,
        ACCOUNT_UPDATED: accountCreatedOrUpdated,
        ACCOUNT_DELETED: createHandler('account-deleted'),
        GROUP_CREATED: groupCreatedOrUpdated,
        GROUP_UPDATED: groupCreatedOrUpdated,
        GROUP_DELETED: createHandler('group-deleted'),
        ...overrides,
    };
}

function createDependencies(handlers: EventHandlerMap): EventRouteDependencies {
    return {
        createContext: createAppContext,
        createHandlers: () => handlers,
    };
}

function buildEvent(type: string): object {
    return {
        type,
        user: { username: 'tester' },
        agent: { id: 'tester' },
        book: { id: 'book-1', name: 'Test Book' },
        data: { object: {} },
    };
}

async function postEvent(app: ReturnType<typeof createApp>, type: string): Promise<Response> {
    return app.request('/events', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer should-not-be-read',
            'bkper-oauth-token': 'should-not-be-read',
            'bkper-agent-id': 'should-not-be-read',
        },
        body: JSON.stringify(buildEvent(type)),
    });
}

describe('legacy event dispatcher', () => {
    for (const routingCase of ROUTING_CASES) {
        test(`routes ${routingCase.type} to its legacy handler`, async () => {
            const app = createApp(createDependencies(createTestHandlers()));
            const response = await postEvent(app, routingCase.type);

            expect(response.status).toBe(200);
            expect(await response.text()).toBe(
                JSON.stringify({ result: routingCase.result }, null, 4)
            );
        });
    }

    test('keeps every subscribed production handler as an explicit no-op stub', async () => {
        const app = createApp();

        for (const eventType of SUBSCRIBED_EVENT_TYPES) {
            const response = await postEvent(app, eventType);
            expect(await response.json()).toEqual({ result: false });
        }
    });

    test('returns the legacy no-op response for unknown events', async () => {
        const app = createApp(createDependencies(createTestHandlers()));
        const response = await postEvent(app, 'UNKNOWN_EVENT');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(JSON.stringify({ result: false }, null, 4));
    });

    test('creates an isolated app context for every request', async () => {
        const contexts: AppContext[] = [];
        const dependencies: EventRouteDependencies = {
            createContext: () => new AppContext(new Bkper()),
            createHandlers: context => {
                contexts.push(context);
                return createTestHandlers();
            },
        };
        const app = createApp(dependencies);

        await postEvent(app, 'UNKNOWN_EVENT');
        await postEvent(app, 'UNKNOWN_EVENT');

        expect(contexts).toHaveLength(2);
        expect(contexts[0]).not.toBe(contexts[1]);
    });

    test('creates Bkper without legacy token or agent providers', () => {
        const config = createAppContext().bkper.getConfig();

        expect(config.oauthTokenProvider).toBeUndefined();
        expect(config.agentIdProvider).toBeUndefined();
        expect(config.apiKeyProvider).toBeUndefined();
    });

    test('preserves the legacy stack-array error response', async () => {
        const failingHandler: EventHandlerContract = {
            handleEvent: async () => {
                throw new Error('handler failed');
            },
        };
        const handlers = createTestHandlers({ TRANSACTION_POSTED: failingHandler });
        const app = createApp(createDependencies(handlers));
        const originalConsoleError = console.error;
        console.error = () => undefined;

        try {
            const response = await postEvent(app, 'TRANSACTION_POSTED');
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body.error).toBeArray();
            expect(body.error[0]).toBe('Error: handler failed');
        } finally {
            console.error = originalConsoleError;
        }
    });
});
