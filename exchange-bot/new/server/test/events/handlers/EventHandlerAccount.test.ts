import { describe, expect, test } from 'bun:test';
import { Account, Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerAccount } from '../../../src/events/handlers/EventHandlerAccount.js';

class TestEventHandlerAccount extends EventHandlerAccount {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }

    protected async connectedAccountNotFound(): Promise<string | null> {
        return 'not-found';
    }

    protected async connectedAccountFound(): Promise<string | null> {
        return 'found';
    }
}

function createBook(id: string, name: string, code?: string): Book {
    return new Book({ id, name, properties: code ? { exc_code: code } : {} });
}

function createEvent(previousName?: string): bkper.Event {
    return {
        data: {
            object: { id: 'base-account', name: 'New Name' },
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function createHandler(): TestEventHandlerAccount {
    return new TestEventHandlerAccount(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy shared Account synchronization behavior', () => {
    test('looks up current, previous, and trailing-space names in order', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const trailingAccount = new Account(connectedBook, {
            id: 'connected-account',
            name: 'New Name ',
        });
        const lookups: (string | undefined)[] = [];
        connectedBook.getAccount = async name => {
            lookups.push(name);
            return name === 'New Name ' ? trailingAccount : undefined;
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent('Old Name')
        );

        expect(result).toBe('found');
        expect(lookups).toEqual(['New Name', 'Old Name', 'New Name ']);
    });

    test('does nothing when the connected Book has no exchange code', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book');
        let lookups = 0;
        connectedBook.getAccount = async () => {
            lookups += 1;
            return undefined;
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent()
        );

        expect(result).toBeNull();
        expect(lookups).toBe(0);
    });
});
