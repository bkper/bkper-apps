import { afterEach, describe, expect, test } from 'bun:test';
import type { Bkper } from 'bkper-js';
import { AppContext } from '../../src/AppContext';
import EventHandlerTransactionDeleted from '../../src/events/handlers/EventHandlerTransactionDeleted';
import EventHandlerTransactionPosted from '../../src/events/handlers/EventHandlerTransactionPosted';
import EventHandlerTransactionUpdated from '../../src/events/handlers/EventHandlerTransactionUpdated';
import app from '../../src/index';

type SubscribedEventType =
    'TRANSACTION_POSTED' | 'TRANSACTION_DELETED' | 'TRANSACTION_RESTORED' | 'TRANSACTION_UPDATED';

type HandlerResult = string[] | string | boolean;
type HandlerMethod = (this: object, event: bkper.Event) => Promise<HandlerResult>;

interface HandlerClass {
    prototype: object;
}

interface RoutingCase {
    type: SubscribedEventType;
    handlerClass: HandlerClass;
    result: string;
}

interface HandlerCall {
    handler: object;
    type: bkper.Event['type'];
}

const ROUTING_CASES: readonly RoutingCase[] = [
    {
        type: 'TRANSACTION_POSTED',
        handlerClass: EventHandlerTransactionPosted,
        result: 'transaction-posted',
    },
    {
        type: 'TRANSACTION_DELETED',
        handlerClass: EventHandlerTransactionDeleted,
        result: 'transaction-deleted',
    },
    {
        type: 'TRANSACTION_RESTORED',
        handlerClass: EventHandlerTransactionPosted,
        result: 'transaction-restored',
    },
    {
        type: 'TRANSACTION_UPDATED',
        handlerClass: EventHandlerTransactionUpdated,
        result: 'transaction-updated',
    },
];

const restoreHandlers: (() => void)[] = [];

afterEach(() => {
    while (restoreHandlers.length > 0) {
        restoreHandlers.pop()?.();
    }
});

function replaceHandleEvent(handlerClass: HandlerClass, handleEvent: HandlerMethod): void {
    const descriptor = Object.getOwnPropertyDescriptor(handlerClass.prototype, 'handleEvent');

    Object.defineProperty(handlerClass.prototype, 'handleEvent', {
        configurable: true,
        writable: true,
        value: handleEvent,
    });

    restoreHandlers.push(() => {
        if (descriptor) {
            Object.defineProperty(handlerClass.prototype, 'handleEvent', descriptor);
        } else {
            Reflect.deleteProperty(handlerClass.prototype, 'handleEvent');
        }
    });
}

function interceptHandlers(): HandlerCall[] {
    const calls: HandlerCall[] = [];
    const interceptedClasses = new Set<HandlerClass>();

    for (const routingCase of ROUTING_CASES) {
        if (interceptedClasses.has(routingCase.handlerClass)) {
            continue;
        }
        interceptedClasses.add(routingCase.handlerClass);

        replaceHandleEvent(routingCase.handlerClass, async function (event) {
            calls.push({ handler: this, type: event.type });
            const matchedCase = ROUTING_CASES.find(
                candidate =>
                    candidate.handlerClass === routingCase.handlerClass &&
                    candidate.type === event.type
            );
            if (!matchedCase) {
                throw new Error(`Unexpected event type ${event.type}`);
            }
            return matchedCase.result;
        });
    }

    return calls;
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

async function postEvent(type: string): Promise<Response> {
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

function getAppContext(handler: object): AppContext {
    const context: unknown = Reflect.get(handler, 'context');
    if (!(context instanceof AppContext)) {
        throw new Error('Handler has no AppContext');
    }
    return context;
}

describe('legacy event dispatcher', () => {
    for (const routingCase of ROUTING_CASES) {
        test(`routes ${routingCase.type} to its legacy handler`, async () => {
            const calls = interceptHandlers();
            const response = await postEvent(routingCase.type);

            expect(response.status).toBe(200);
            expect(await response.text()).toBe(
                JSON.stringify({ result: routingCase.result }, null, 4)
            );
            expect(calls.map(call => call.type)).toEqual([routingCase.type]);
        });
    }

    test('preserves the legacy array result response', async () => {
        replaceHandleEvent(EventHandlerTransactionPosted, async () => ['first', 'second']);

        const response = await postEvent('TRANSACTION_POSTED');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(
            JSON.stringify({ result: ['first', 'second'] }, null, 4)
        );
    });

    test('returns the legacy no-op response for unknown events', async () => {
        const response = await postEvent('UNKNOWN_EVENT');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(JSON.stringify({ result: false }, null, 4));
    });

    test('constructs the selected handler with isolated request context', async () => {
        const calls = interceptHandlers();

        await postEvent('TRANSACTION_POSTED');
        await postEvent('TRANSACTION_POSTED');

        expect(calls).toHaveLength(2);
        expect(calls[0].handler).not.toBe(calls[1].handler);

        const firstContext = getAppContext(calls[0].handler);
        const secondContext = getAppContext(calls[1].handler);
        expect(firstContext).not.toBe(secondContext);
        expect(firstContext.bkper).not.toBe(secondContext.bkper);
    });

    test('creates Bkper without legacy token or agent providers', async () => {
        const calls = interceptHandlers();

        await postEvent('TRANSACTION_POSTED');

        const bkper: Bkper = getAppContext(calls[0].handler).bkper;
        const config = bkper.getConfig();
        expect(config.oauthTokenProvider).toBeUndefined();
        expect(config.agentIdProvider).toBeUndefined();
        expect(config.apiKeyProvider).toBeUndefined();
    });

    test('preserves the legacy stack-array error response', async () => {
        replaceHandleEvent(EventHandlerTransactionPosted, async () => {
            throw new Error('handler failed');
        });
        const originalConsoleError = console.error;
        console.error = () => undefined;

        try {
            const response = await postEvent('TRANSACTION_POSTED');
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body.error).toBeArray();
            expect(body.error[0]).toBe('Error: handler failed');
        } finally {
            console.error = originalConsoleError;
        }
    });
});
