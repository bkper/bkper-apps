import { describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { EventHandlerGroup } from '../../../src/events/handlers/EventHandlerGroup.js';

class TestEventHandlerGroup extends EventHandlerGroup {
    processConnectedBook(
        baseBook: Book,
        connectedBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(baseBook, connectedBook, event);
    }

    protected async connectedGroupNotFound(): Promise<string | null> {
        return 'not-found';
    }

    protected async connectedGroupFound(): Promise<string | null> {
        return 'found';
    }
}

function createBook(id: string, name: string, code?: string): Book {
    return new Book({ id, name, properties: code ? { exc_code: code } : {} });
}

function createEvent(previousName?: string): bkper.Event {
    return {
        data: {
            object: { id: 'base-group', name: 'New Group' },
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function createHandler(): TestEventHandlerGroup {
    return new TestEventHandlerGroup(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy shared Group synchronization behavior', () => {
    test('looks up current, previous, and trailing-space names in order', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book', 'EUR');
        const trailingGroup = new Group(connectedBook, {
            id: 'connected-group',
            name: 'New Group ',
        });
        const lookups: (string | undefined)[] = [];
        connectedBook.getGroup = async name => {
            lookups.push(name);
            return name === 'New Group ' ? trailingGroup : undefined;
        };

        const result = await createHandler().processConnectedBook(
            baseBook,
            connectedBook,
            createEvent('Old Group')
        );

        expect(result).toBe('found');
        expect(lookups).toEqual(['New Group', 'Old Group', 'New Group ']);
    });

    test('does nothing when the connected Book has no exchange code', async () => {
        const baseBook = createBook('base-book', 'Base Book', 'USD');
        const connectedBook = createBook('connected-book', 'Connected Book');
        let lookups = 0;
        connectedBook.getGroup = async () => {
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
