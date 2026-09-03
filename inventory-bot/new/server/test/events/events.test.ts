import { afterEach, describe, expect, test } from 'bun:test';
import { BkperError, type Bkper } from 'bkper-js';
import { EventHandlerTransactionChecked } from '../../src/events/handlers/EventHandlerTransactionChecked.js';
import { EventHandlerTransactionDeleted } from '../../src/events/handlers/EventHandlerTransactionDeleted.js';
import { EventHandlerTransactionPosted } from '../../src/events/handlers/EventHandlerTransactionPosted.js';
import { EventHandlerTransactionUnchecked } from '../../src/events/handlers/EventHandlerTransactionUnchecked.js';
import type { EventResult } from '../../src/events/types.js';
import { createApp } from '../../src/index.js';
import { AppContext } from '../../src/shared/app-context.js';

type SubscribedEventType =
    'TRANSACTION_POSTED' | 'TRANSACTION_CHECKED' | 'TRANSACTION_UNCHECKED' | 'TRANSACTION_DELETED';

type HandlerMethod = (this: object, event: bkper.Event) => Promise<EventResult>;

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
        type: 'TRANSACTION_CHECKED',
        handlerClass: EventHandlerTransactionChecked,
        result: 'transaction-checked',
    },
    {
        type: 'TRANSACTION_UNCHECKED',
        handlerClass: EventHandlerTransactionUnchecked,
        result: 'transaction-unchecked',
    },
    {
        type: 'TRANSACTION_DELETED',
        handlerClass: EventHandlerTransactionDeleted,
        result: 'transaction-deleted',
    },
];

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};
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

    for (const routingCase of ROUTING_CASES) {
        replaceHandleEvent(routingCase.handlerClass, async function (event) {
            calls.push({ handler: this, type: event.type });
            return { result: routingCase.result };
        });
    }

    return calls;
}

async function postEvent(type: string): Promise<Response> {
    return createApp().request(
        '/events',
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer should-not-be-read',
                'bkper-oauth-token': 'should-not-be-read',
                'bkper-agent-id': 'should-not-be-read',
            },
            body: JSON.stringify({
                type,
                user: { username: 'tester' },
                agent: { id: 'tester' },
                book: { id: 'book-1', name: 'Test Book' },
                data: { object: {} },
            }),
        },
        env
    );
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
            expect(response.headers.get('content-type')).toBe('application/json');
            expect(await response.text()).toBe(
                JSON.stringify({ result: routingCase.result }, null, 4)
            );
            expect(calls.map(call => call.type)).toEqual([routingCase.type]);
        });
    }

    test('returns the legacy no-op response for unknown events', async () => {
        const response = await postEvent('UNKNOWN_EVENT');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(JSON.stringify({ result: false }, null, 4));
    });

    test('keeps every subscribed business handler non-mutating in Chunk 3', async () => {
        for (const routingCase of ROUTING_CASES) {
            const response = await createApp().request(
                '/events',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        type: routingCase.type,
                        user: { username: 'tester' },
                        book: {
                            id: 'financial',
                            name: 'Financial',
                            collection: {
                                books: [
                                    {
                                        id: 'inventory',
                                        name: 'Inventory',
                                        properties: { inventory_book: 'true' },
                                    },
                                ],
                            },
                        },
                        data: {
                            object: {
                                transaction: { id: 'draft', posted: false },
                            },
                        },
                    }),
                },
                env
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ result: false });
        }
    });

    test('constructs handlers with isolated request contexts', async () => {
        const calls = interceptHandlers();

        await postEvent('TRANSACTION_POSTED');
        await postEvent('TRANSACTION_POSTED');

        const firstContext = getAppContext(calls[0]!.handler);
        const secondContext = getAppContext(calls[1]!.handler);
        expect(calls[0]!.handler).not.toBe(calls[1]!.handler);
        expect(firstContext).not.toBe(secondContext);
        expect(firstContext.bkper).not.toBe(secondContext.bkper);
        expect(Object.is(firstContext.env, env)).toBeTrue();
        expect(Object.is(secondContext.env, env)).toBeTrue();
    });

    test('creates Bkper without legacy authentication providers', async () => {
        const calls = interceptHandlers();

        await postEvent('TRANSACTION_POSTED');

        const bkper: Bkper = getAppContext(calls[0]!.handler).bkper;
        const config = bkper.getConfig();
        expect(config.oauthTokenProvider).toBeUndefined();
        expect(config.agentIdProvider).toBeUndefined();
        expect(config.apiKeyProvider).toBeUndefined();
    });

    test('preserves the legacy stack-array error response', async () => {
        replaceHandleEvent(EventHandlerTransactionPosted, async () => {
            throw new BkperError(403, 'handler failed', 'forbidden');
        });
        const originalConsoleError = console.error;
        console.error = () => undefined;

        try {
            const response = await postEvent('TRANSACTION_POSTED');
            const body: unknown = await response.json();

            expect(response.status).toBe(200);
            expect(body).toEqual(
                expect.objectContaining({
                    error: expect.arrayContaining(['BkperError: handler failed']),
                })
            );
        } finally {
            console.error = originalConsoleError;
        }
    });

    test('returns the event error envelope when the request body is invalid', async () => {
        const originalConsoleError = console.error;
        console.error = () => undefined;

        try {
            const response = await createApp().request(
                '/events',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{',
                },
                env
            );
            const body: unknown = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('application/json');
            expect(body).toEqual(expect.objectContaining({ error: expect.anything() }));
        } finally {
            console.error = originalConsoleError;
        }
    });
});
