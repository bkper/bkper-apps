import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { EventHandlerGroupDeleted } from '../../../src/events/handlers/EventHandlerGroupDeleted.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerGroupDeleted extends EventHandlerGroupDeleted {
    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }
}

const originalGroupRemove = Group.prototype.remove;

afterEach(() => {
    Group.prototype.remove = originalGroupRemove;
});

function createHandler(): TestEventHandlerGroupDeleted {
    return new TestEventHandlerGroupDeleted(new AppContext(new Bkper(), { ASSETS: { fetch } }));
}

function createBook(id: string, name: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name, properties });
}

function createEvent(): bkper.Event {
    return {
        data: {
            object: {
                id: 'financial-group',
                name: 'NASDAQ',
                properties: { stock_exc_code: 'USD' },
            },
        },
    };
}

describe('legacy Group deletion synchronization', () => {
    test('deletes the matching Portfolio Group', async () => {
        const financialBook = createBook('financial', 'Financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio', 'Portfolio');
        const portfolioGroup = new Group(portfolioBook, {
            id: 'portfolio-group',
            name: 'NASDAQ',
        });
        const removedGroups: Group[] = [];
        portfolioBook.getGroup = async () => portfolioGroup;
        Group.prototype.remove = async function (): Promise<Group> {
            removedGroups.push(this);
            return this;
        };

        const result = await createHandler().processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent()
        );

        expect(removedGroups).toEqual([portfolioGroup]);
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP NASDAQ DELETED"
        );
    });

    test('preserves the accepted no-mutation response when the Group is absent', async () => {
        const financialBook = createBook('financial', 'Financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio', 'Portfolio');
        let removals = 0;
        portfolioBook.getGroup = async () => undefined;
        Group.prototype.remove = async function (): Promise<Group> {
            removals += 1;
            return this;
        };

        const result = await createHandler().processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent()
        );

        expect(removals).toBe(0);
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP NASDAQ NOT Found"
        );
    });
});
