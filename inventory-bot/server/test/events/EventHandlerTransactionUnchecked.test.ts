import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper } from 'bkper-js';
import { EventHandlerTransactionUnchecked } from '../../src/events/handlers/EventHandlerTransactionUnchecked.js';
import { InterceptorFlagRebuild } from '../../src/events/interceptors/InterceptorFlagRebuild.js';
import { AppContext } from '../../src/shared/app-context.js';

const originalFlagRebuildIntercept = InterceptorFlagRebuild.prototype.intercept;

afterEach(() => {
    InterceptorFlagRebuild.prototype.intercept = originalFlagRebuildIntercept;
});

function createEvent(): bkper.Event {
    return {
        type: 'TRANSACTION_UNCHECKED',
        book: {
            id: 'inventory',
            name: 'Inventory',
            properties: { inventory_book: 'true' },
        },
        agent: { id: 'user' },
        user: { username: 'tester' },
        data: { object: {} },
    };
}

describe('legacy transaction unchecked handler', () => {
    test('delegates manual unchecking to the rebuild interceptor', async () => {
        const calls: string[] = [];
        InterceptorFlagRebuild.prototype.intercept = async (book, event) => {
            calls.push(`${book.getId()}:${event.type}`);
            return { warning: 'rebuild', result: 'rebuild' };
        };

        const result = await new EventHandlerTransactionUnchecked(
            new AppContext(new Bkper(), { ASSETS: { fetch } })
        ).handleEvent(createEvent());

        expect(calls).toEqual(['inventory:TRANSACTION_UNCHECKED']);
        expect(result).toEqual({ warning: 'rebuild', result: 'rebuild' });
    });
});
