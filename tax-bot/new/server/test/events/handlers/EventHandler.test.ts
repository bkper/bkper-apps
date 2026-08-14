import { describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/AppContext';
import EventHandler from '../../../src/events/handlers/EventHandler';
import type { EventResultValue } from '../../../src/events/types';

class RecordingEventHandler extends EventHandler {
    readonly calls: { book: Book; transaction: bkper.Transaction; event: bkper.Event }[] = [];

    protected async processTransaction(
        book: Book,
        transaction: bkper.Transaction,
        event: bkper.Event
    ): Promise<EventResultValue> {
        this.calls.push({ book, transaction, event });
        return 'processed';
    }

    buildId(
        taxTag: string,
        transaction: bkper.Transaction,
        accountOrGroup: bkper.Account | bkper.Group
    ): string {
        return this.getId(taxTag, transaction, accountOrGroup);
    }
}

function createBook(): Book {
    return new Book({
        id: 'book-1',
        name: 'Tax Book',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
    });
}

function createAccount(id: string): bkper.Account {
    return { id, name: id, properties: {}, groups: [] };
}

function createTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'transaction-1',
        posted: true,
        agentId: 'tester',
        amount: '100',
        creditAccount: createAccount('origin'),
        debitAccount: createAccount('destination'),
        properties: {},
        ...overrides,
    };
}

function createEvent(transaction: bkper.Transaction, eventAgentId = 'tester'): bkper.Event {
    return {
        type: 'TRANSACTION_POSTED',
        book: createBook().json(),
        user: { username: 'tester' },
        agent: { id: eventAgentId },
        data: { object: { transaction } },
    };
}

function createHandler(): RecordingEventHandler {
    return new RecordingEventHandler(new AppContext(new Bkper()));
}

describe('legacy common Transaction event behavior', () => {
    test('extracts the Transaction operation and constructs the event Book', async () => {
        const handler = createHandler();
        const transaction = createTransaction();
        const event = createEvent(transaction);

        const result = await handler.handleEvent(event);

        expect(result).toBe('processed');
        expect(handler.calls).toHaveLength(1);
        expect(handler.calls[0].transaction).toBe(transaction);
        expect(handler.calls[0].event).toBe(event);
        expect(handler.calls[0].book.getId()).toBe('book-1');
        expect(handler.calls[0].book.getName()).toBe('Tax Book');
    });

    test('skips a non-posted Transaction', async () => {
        const handler = createHandler();

        const result = await handler.handleEvent(createEvent(createTransaction({ posted: false })));

        expect(result).toBe(false);
        expect(handler.calls).toHaveLength(0);
    });

    test('skips Exchange Bot from the Transaction agent field', async () => {
        const handler = createHandler();

        const result = await handler.handleEvent(
            createEvent(createTransaction({ agentId: 'exchange-bot' }), 'other-agent')
        );

        expect(result).toBe(false);
        expect(handler.calls).toHaveLength(0);
    });

    test('does not use the Event agent field for the Exchange Bot guard', async () => {
        const handler = createHandler();

        const result = await handler.handleEvent(
            createEvent(createTransaction({ agentId: 'other-agent' }), 'exchange-bot')
        );

        expect(result).toBe('processed');
        expect(handler.calls).toHaveLength(1);
    });

    test('builds the established remote id', () => {
        const handler = createHandler();

        expect(
            handler.buildId(
                'tax_included_rate',
                createTransaction({ id: 'tx-123' }),
                createAccount('account-456')
            )
        ).toBe('tax_included_rate_tx-123_account-456');
    });
});
