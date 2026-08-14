import { describe, expect, test } from 'bun:test';
import { Amount, Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/AppContext';
import EventHandlerTransactionPosted from '../../../src/events/handlers/EventHandlerTransactionPosted';

class TaxSourceHandler extends EventHandlerTransactionPosted {
    readonly lookupOrder: string[] = [];

    getTaxRate(book: Book, accountOrGroup: bkper.Account | bkper.Group, included: boolean): Amount {
        return this.getTaxRateFromAccountOrGroup_(book, accountOrGroup, included);
    }

    protected getTaxRateFromAccountOrGroup_(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        included: boolean
    ): Amount {
        this.lookupOrder.push(`${included ? 'included' : 'excluded'}:${accountOrGroup.id}`);
        return super.getTaxRateFromAccountOrGroup_(book, accountOrGroup, included);
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

function createAccount(
    id: string,
    properties: Record<string, string> = {},
    groups: bkper.Group[] = []
): bkper.Account {
    return { id, name: id, properties, groups };
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

function createHandler(): TaxSourceHandler {
    return new TaxSourceHandler(new AppContext(new Bkper()));
}

describe('legacy tax source discovery', () => {
    test('skips Tax Bot from the Transaction agent field before source discovery', async () => {
        const handler = createHandler();

        const result = await handler.handleEvent(
            createEvent(createTransaction({ agentId: 'sales-tax-bot' }), 'other-agent')
        );

        expect(result).toBe(false);
        expect(handler.lookupOrder).toEqual([]);
    });

    test('does not use the Event agent field for the Tax Bot guard', async () => {
        const handler = createHandler();

        await handler.handleEvent(
            createEvent(createTransaction({ agentId: 'other-agent' }), 'sales-tax-bot')
        );

        expect(handler.lookupOrder.length).toBeGreaterThan(0);
    });

    test('discovers origin before destination and Account before embedded Groups', async () => {
        const handler = createHandler();
        const origin = createAccount('origin', {}, [
            { id: 'origin-group-1', properties: {} },
            { id: 'origin-group-2', properties: {} },
        ]);
        const destination = createAccount('destination', {}, [
            { id: 'destination-group-1', properties: {} },
        ]);

        await handler.handleEvent(
            createEvent(
                createTransaction({
                    creditAccount: origin,
                    debitAccount: destination,
                })
            )
        );

        expect(handler.lookupOrder).toEqual([
            'excluded:origin',
            'excluded:origin-group-1',
            'excluded:origin-group-2',
            'excluded:destination',
            'excluded:destination-group-1',
            'included:origin',
            'included:origin-group-1',
            'included:origin-group-2',
            'included:destination',
            'included:destination-group-1',
        ]);
    });

    const RATE_CASES: readonly {
        name: string;
        properties: Record<string, string>;
        included: boolean;
        expected: string;
    }[] = [
        {
            name: 'uses the current included rate before its deprecated alias',
            properties: { tax_included_rate: '12', tax_included: '8' },
            included: true,
            expected: '12',
        },
        {
            name: 'falls back to the deprecated included rate',
            properties: { tax_included_rate: '', tax_included: '8' },
            included: true,
            expected: '8',
        },
        {
            name: 'uses the current excluded rate before its deprecated alias',
            properties: { tax_excluded_rate: '7', tax_excluded: '3' },
            included: false,
            expected: '7',
        },
        {
            name: 'treats a positive legacy tax_rate as included only',
            properties: { tax_rate: '15' },
            included: false,
            expected: '0',
        },
        {
            name: 'returns a positive legacy tax_rate for included discovery',
            properties: { tax_rate: '15' },
            included: true,
            expected: '15',
        },
        {
            name: 'treats a negative legacy tax_rate as excluded only',
            properties: { tax_rate: '-15' },
            included: true,
            expected: '0',
        },
        {
            name: 'returns a negative legacy tax_rate for excluded discovery',
            properties: { tax_rate: '-15' },
            included: false,
            expected: '-15',
        },
        {
            name: 'preserves a negative current included rate',
            properties: { tax_included_rate: '-5' },
            included: true,
            expected: '-5',
        },
        {
            name: 'preserves a zero current included rate',
            properties: { tax_included_rate: '0' },
            included: true,
            expected: '0',
        },
        {
            name: 'returns zero for a missing rate',
            properties: {},
            included: true,
            expected: '0',
        },
    ];

    for (const rateCase of RATE_CASES) {
        test(rateCase.name, () => {
            const handler = createHandler();

            const result = handler.getTaxRate(
                createBook(),
                createAccount('source', rateCase.properties),
                rateCase.included
            );

            expect(result.toString()).toBe(rateCase.expected);
        });
    }

    test('preserves the empty legacy tax_rate parsing failure', () => {
        const handler = createHandler();

        expect(() =>
            handler.getTaxRate(
                createBook(),
                createAccount('source', { tax_rate: '', tax_included_rate: '12' }),
                true
            )
        ).toThrow('[big.js] Invalid number');
    });
});
