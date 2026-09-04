import { describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { EventHandlerGroup } from '../../../src/events/handlers/EventHandlerGroup.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerGroup extends EventHandlerGroup {
    foundGroup?: Group;
    notFound = false;

    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }

    protected async connectedGroupNotFound(): Promise<string> {
        this.notFound = true;
        return 'NOT FOUND';
    }

    protected async connectedGroupFound(
        _financialBook: Book,
        _portfolioBook: Book,
        _financialGroup: bkper.Group,
        portfolioGroup: Group
    ): Promise<string> {
        this.foundGroup = portfolioGroup;
        return 'FOUND';
    }
}

function createHandler(): TestEventHandlerGroup {
    return new TestEventHandlerGroup(new AppContext(new Bkper(), { ASSETS: { fetch } }));
}

function createBook(id: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name: id, properties });
}

function createEvent(name: string, exchangeCode: string, previousName?: string): bkper.Event {
    return {
        data: {
            object: {
                id: 'financial-group',
                name,
                properties: { stock_exc_code: exchangeCode },
            },
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

describe('legacy Group synchronization selection', () => {
    test('falls back to the previous Group name after the current name is absent', async () => {
        const financialBook = createBook('financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio');
        const portfolioGroup = new Group(portfolioBook, {
            id: 'portfolio-group',
            name: 'Old Market',
        });
        const lookups: (string | undefined)[] = [];
        portfolioBook.getGroup = async name => {
            lookups.push(name);
            return name === 'Old Market' ? portfolioGroup : undefined;
        };
        const handler = createHandler();

        const result = await handler.processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent('New Market', 'USD', 'Old Market')
        );

        expect(lookups).toEqual(['New Market', 'Old Market']);
        expect(result).toBe('FOUND');
        expect(handler.foundGroup).toBe(portfolioGroup);
        expect(handler.notFound).toBe(false);
    });
});
