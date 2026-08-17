import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper } from 'bkper-js';
import { AppContext } from '../../../src/AppContext';
import EventHandlerTransactionDeleted from '../../../src/events/handlers/EventHandlerTransactionDeleted';
import EventHandlerTransactionPosted from '../../../src/events/handlers/EventHandlerTransactionPosted';
import EventHandlerTransactionUpdated from '../../../src/events/handlers/EventHandlerTransactionUpdated';
import type { EventResultValue } from '../../../src/events/types';

type ChildKind = 'deleted' | 'posted';
type ChildBehavior = (event: bkper.Event) => Promise<EventResultValue>;
type HandlerMethod = (this: object, event: bkper.Event) => Promise<EventResultValue>;

interface HandlerClass {
    prototype: object;
}

interface ChildCall {
    kind: ChildKind;
    handler: object;
    context: AppContext;
    event: bkper.Event;
}

const methodRestorers: (() => void)[] = [];

afterEach(() => {
    while (methodRestorers.length > 0) {
        methodRestorers.pop()?.();
    }
});

function replaceHandleEvent(handlerClass: HandlerClass, handleEvent: HandlerMethod): void {
    const descriptor = Object.getOwnPropertyDescriptor(handlerClass.prototype, 'handleEvent');
    Object.defineProperty(handlerClass.prototype, 'handleEvent', {
        configurable: true,
        writable: true,
        value: handleEvent,
    });
    methodRestorers.push(() => {
        if (descriptor) {
            Object.defineProperty(handlerClass.prototype, 'handleEvent', descriptor);
        } else {
            Reflect.deleteProperty(handlerClass.prototype, 'handleEvent');
        }
    });
}

function getAppContext(handler: object): AppContext {
    const context: unknown = Reflect.get(handler, 'context');
    if (!(context instanceof AppContext)) {
        throw new Error('Handler has no AppContext');
    }
    return context;
}

function interceptChildHandlers(
    deletedBehavior: ChildBehavior = async () => false,
    postedBehavior: ChildBehavior = async () => false
): ChildCall[] {
    const calls: ChildCall[] = [];

    replaceHandleEvent(EventHandlerTransactionDeleted, async function (event) {
        calls.push({
            kind: 'deleted',
            handler: this,
            context: getAppContext(this),
            event,
        });
        return deletedBehavior(event);
    });
    replaceHandleEvent(EventHandlerTransactionPosted, async function (event) {
        calls.push({
            kind: 'posted',
            handler: this,
            context: getAppContext(this),
            event,
        });
        return postedBehavior(event);
    });

    return calls;
}

function createAccount(id: string): bkper.Account {
    return { id, name: id, properties: {}, groups: [] };
}

function createTransaction(): bkper.Transaction {
    return {
        id: 'source-1',
        posted: true,
        agentId: 'tester',
        date: '2024-01-15',
        amount: '100',
        description: 'Source transaction',
        creditAccount: createAccount('origin'),
        debitAccount: createAccount('destination'),
        properties: {},
    };
}

function createEvent(previousAttributes?: Record<string, string>): bkper.Event {
    return {
        type: 'TRANSACTION_UPDATED',
        book: {
            id: 'book-1',
            name: 'Tax Book',
            decimalSeparator: 'DOT',
            fractionDigits: 2,
        },
        user: { username: 'tester' },
        agent: { id: 'tester' },
        data: {
            object: { transaction: createTransaction() },
            ...(previousAttributes === undefined ? {} : { previousAttributes }),
        },
    };
}

function createHandler(context = new AppContext(new Bkper())): EventHandlerTransactionUpdated {
    return new EventHandlerTransactionUpdated(context);
}

const RELEVANT_CHANGES: readonly { field: string; value: string }[] = [
    { field: 'dateValue', value: '20240114' },
    { field: 'creditAccId', value: 'old-origin' },
    { field: 'debitAccId', value: 'old-destination' },
    { field: 'amount', value: '90' },
    { field: 'tax_included_amount', value: '' },
    { field: 'tax_excluded_amount', value: '' },
];

describe('legacy update change filter', () => {
    for (const change of RELEVANT_CHANGES) {
        test(`recalculates when ${change.field} changed`, async () => {
            const calls = interceptChildHandlers(
                async () => ['deleted'],
                async () => ['posted']
            );

            const result = await createHandler().handleEvent(
                createEvent({ [change.field]: change.value })
            );

            expect(result).toEqual(['deleted', 'posted']);
            expect(calls.map(call => call.kind)).toEqual(['deleted', 'posted']);
        });
    }

    test('keeps prior taxes when only fields outside the legacy filter changed', async () => {
        const calls = interceptChildHandlers(
            async () => ['deleted'],
            async () => ['posted']
        );

        const descriptionResult = await createHandler().handleEvent(
            createEvent({ description: 'Old description', tax_round: '3' })
        );
        const emptyResult = await createHandler().handleEvent(createEvent({}));
        const falseyAmountResult = await createHandler().handleEvent(createEvent({ amount: '' }));

        expect(descriptionResult).toBe(
            'No changes in accounts or amount. Keeping previous calculated taxes.'
        );
        expect(emptyResult).toBe(
            'No changes in accounts or amount. Keeping previous calculated taxes.'
        );
        expect(falseyAmountResult).toBe(
            'No changes in accounts or amount. Keeping previous calculated taxes.'
        );
        expect(calls).toEqual([]);
    });

    test('recalculates when previousAttributes is absent', async () => {
        const calls = interceptChildHandlers(
            async () => ['deleted'],
            async () => ['posted']
        );

        const result = await createHandler().handleEvent(createEvent());

        expect(result).toEqual(['deleted', 'posted']);
        expect(calls.map(call => call.kind)).toEqual(['deleted', 'posted']);
    });
});

describe('legacy update orchestration', () => {
    test('passes the same event and context through deletion before recreation', async () => {
        const context = new AppContext(new Bkper());
        const event = createEvent({ amount: '90', creditAccId: 'old-origin' });
        const source = (event.data!.object as bkper.TransactionOperation).transaction!;
        const sourceBefore = structuredClone(source);
        const calls = interceptChildHandlers(
            async () => ['deleted-1', 'deleted-2'],
            async () => ['posted-1']
        );

        const result = await createHandler(context).handleEvent(event);

        expect(result).toEqual(['deleted-1', 'deleted-2', 'posted-1']);
        expect(calls.map(call => call.kind)).toEqual(['deleted', 'posted']);
        expect(calls[0].event).toBe(event);
        expect(calls[1].event).toBe(event);
        expect(calls[0].context).toBe(context);
        expect(calls[1].context).toBe(context);
        expect(calls[0].handler).not.toBe(calls[1].handler);
        expect(source).toEqual(sourceBefore);
    });

    test('preserves legacy array-only result normalization', async () => {
        let deletedResult: EventResultValue = false;
        let postedResult: EventResultValue = false;
        const calls = interceptChildHandlers(
            async () => deletedResult,
            async () => postedResult
        );
        const cases: readonly {
            deleted: EventResultValue;
            posted: EventResultValue;
            expected: EventResultValue;
        }[] = [
            { deleted: ['deleted'], posted: ['posted'], expected: ['deleted', 'posted'] },
            { deleted: 'deleted-message', posted: ['posted'], expected: ['posted'] },
            { deleted: ['deleted'], posted: 'posted-message', expected: ['deleted'] },
            { deleted: true, posted: false, expected: false },
            { deleted: [], posted: [], expected: false },
        ];

        for (const resultCase of cases) {
            deletedResult = resultCase.deleted;
            postedResult = resultCase.posted;
            calls.length = 0;

            const result = await createHandler().handleEvent(createEvent({ amount: '90' }));

            expect(result).toEqual(resultCase.expected);
            expect(calls.map(call => call.kind)).toEqual(['deleted', 'posted']);
        }
    });

    test('does not recreate taxes when deletion fails', async () => {
        const calls = interceptChildHandlers(
            async () => {
                throw new Error('deletion failed');
            },
            async () => ['posted']
        );

        await expect(createHandler().handleEvent(createEvent({ amount: '90' }))).rejects.toThrow(
            'deletion failed'
        );
        expect(calls.map(call => call.kind)).toEqual(['deleted']);
    });

    test('exposes recreation failure after deletion has completed', async () => {
        const calls = interceptChildHandlers(
            async () => ['deleted'],
            async () => {
                throw new Error('recreation failed');
            }
        );

        await expect(createHandler().handleEvent(createEvent({ amount: '90' }))).rejects.toThrow(
            'recreation failed'
        );
        expect(calls.map(call => call.kind)).toEqual(['deleted', 'posted']);
    });
});
