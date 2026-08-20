import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { EventHandlerGroupCreatedOrUpdated } from '../../../src/events/handlers/EventHandlerGroupCreatedOrUpdated.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerGroupCreatedOrUpdated extends EventHandlerGroupCreatedOrUpdated {
    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }
}

const originalGroupCreate = Group.prototype.create;
const originalGroupUpdate = Group.prototype.update;

afterEach(() => {
    Group.prototype.create = originalGroupCreate;
    Group.prototype.update = originalGroupUpdate;
});

function createHandler(): TestEventHandlerGroupCreatedOrUpdated {
    return new TestEventHandlerGroupCreatedOrUpdated(
        new AppContext(new Bkper(), { ASSETS: { fetch } })
    );
}

function createBook(id: string, name: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name, properties });
}

function createEvent(group: bkper.Group): bkper.Event {
    return { data: { object: group } };
}

function createFinancialGroup(name = 'NASDAQ'): bkper.Group {
    return {
        id: 'financial-group',
        name,
        hidden: true,
        properties: {
            stock_exc_code: 'USD',
            market: 'technology',
            internal_: 'not-synchronized',
        },
        parent: { id: 'financial-parent', name: 'Markets' },
    };
}

describe('legacy Group create and update synchronization', () => {
    test('creates and updates flat Portfolio Groups with visible properties only', async () => {
        const financialBook = createBook('financial', 'Financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio', 'Portfolio');
        const createdGroups: Group[] = [];
        const updatedGroups: Group[] = [];
        let existingGroup: Group | undefined;
        portfolioBook.getGroup = async () => existingGroup;
        Group.prototype.create = async function (): Promise<Group> {
            createdGroups.push(this);
            return this;
        };
        Group.prototype.update = async function (): Promise<Group> {
            updatedGroups.push(this);
            return this;
        };

        const createResult = await createHandler().processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent(createFinancialGroup())
        );

        expect(createdGroups).toHaveLength(1);
        expect(createdGroups[0].json()).toMatchObject({
            name: 'NASDAQ',
            hidden: true,
            properties: { stock_exc_code: 'USD', market: 'technology' },
        });
        expect(createdGroups[0].getProperty('internal_')).toBeUndefined();
        expect(createdGroups[0].getParent()).toBeUndefined();
        expect(createResult).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP NASDAQ CREATED"
        );

        existingGroup = new Group(portfolioBook, {
            id: 'portfolio-group',
            name: 'NASDAQ',
            hidden: false,
            properties: { old: 'value' },
        });

        const updateResult = await createHandler().processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent(createFinancialGroup('New Market'))
        );

        expect(updatedGroups).toEqual([existingGroup]);
        expect(existingGroup.json()).toMatchObject({
            name: 'New Market',
            hidden: true,
            properties: { stock_exc_code: 'USD', market: 'technology' },
        });
        expect(existingGroup.getProperty('internal_')).toBeUndefined();
        expect(existingGroup.getParent()).toBeUndefined();
        expect(updateResult).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP New Market UPDATED"
        );
    });
});
