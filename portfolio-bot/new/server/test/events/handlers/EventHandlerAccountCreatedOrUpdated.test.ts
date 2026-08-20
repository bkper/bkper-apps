import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { EventHandlerAccountCreatedOrUpdated } from '../../../src/events/handlers/EventHandlerAccountCreatedOrUpdated.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerAccountCreatedOrUpdated extends EventHandlerAccountCreatedOrUpdated {
    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }
}

const originalAccountCreate = Account.prototype.create;
const originalAccountUpdate = Account.prototype.update;
const originalGroupCreate = Group.prototype.create;

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
    Account.prototype.update = originalAccountUpdate;
    Group.prototype.create = originalGroupCreate;
});

function createHandler(): TestEventHandlerAccountCreatedOrUpdated {
    return new TestEventHandlerAccountCreatedOrUpdated(
        new AppContext(new Bkper(), { ASSETS: { fetch } })
    );
}

function createBook(id: string, name: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name, properties });
}

function createExchangeGroup(book: Book): Group {
    return new Group(book, {
        id: 'financial-group',
        name: 'NASDAQ',
        hidden: true,
        properties: {
            stock_exc_code: 'USD',
            market: 'technology',
            internal_: 'not-synchronized',
        },
    });
}

function createAccount(group: Group, name = 'ACME'): bkper.Account {
    return {
        id: 'financial-account',
        name,
        type: AccountType.ASSET,
        archived: false,
        groups: [group.json()],
    };
}

function createEvent(account: bkper.Account, previousName?: string): bkper.Event {
    return {
        data: {
            object: account,
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

describe('legacy Account create and update synchronization', () => {
    test('creates a missing Portfolio Account and its eligible exchange Group', async () => {
        const financialBook = createBook('financial', 'Financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio', 'Portfolio');
        const financialGroup = createExchangeGroup(financialBook);
        const createdAccounts: Account[] = [];
        const createdGroups: Group[] = [];
        financialBook.getGroup = async () => financialGroup;
        portfolioBook.getAccount = async () => undefined;
        portfolioBook.getGroup = async () => undefined;
        Group.prototype.create = async function (): Promise<Group> {
            createdGroups.push(this);
            return this;
        };
        Account.prototype.create = async function (): Promise<Account> {
            createdAccounts.push(this);
            return this;
        };

        const result = await createHandler().processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent(createAccount(financialGroup))
        );

        expect(createdGroups).toHaveLength(1);
        expect(createdGroups[0].json()).toMatchObject({
            name: 'NASDAQ',
            hidden: true,
            properties: { stock_exc_code: 'USD', market: 'technology' },
        });
        expect(createdGroups[0].getProperty('internal_')).toBeUndefined();
        expect(createdGroups[0].getParent()).toBeUndefined();
        expect(createdAccounts).toHaveLength(1);
        expect(createdAccounts[0].json()).toMatchObject({
            name: 'ACME',
            type: AccountType.ASSET,
            archived: false,
            groups: [{ name: 'NASDAQ' }],
        });
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME CREATED"
        );
    });

    test('replaces the synchronized fields of an existing Portfolio Account', async () => {
        const financialBook = createBook('financial', 'Financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio', 'Portfolio');
        const financialGroup = createExchangeGroup(financialBook);
        const portfolioGroup = createExchangeGroup(portfolioBook);
        const portfolioAccount = new Account(portfolioBook, {
            id: 'portfolio-account',
            name: 'Old ACME',
            type: AccountType.LIABILITY,
            archived: false,
        });
        const accountLookups: (string | undefined)[] = [];
        const updatedAccounts: Account[] = [];
        financialBook.getGroup = async () => financialGroup;
        portfolioBook.getGroup = async () => portfolioGroup;
        portfolioBook.getAccount = async name => {
            accountLookups.push(name);
            return name === 'Old ACME' ? portfolioAccount : undefined;
        };
        Account.prototype.update = async function (): Promise<Account> {
            updatedAccounts.push(this);
            return this;
        };
        const financialAccount = {
            ...createAccount(financialGroup, 'New ACME'),
            type: AccountType.ASSET,
            archived: true,
        };

        const result = await createHandler().processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent(financialAccount, 'Old ACME')
        );

        expect(accountLookups).toEqual(['New ACME', 'Old ACME']);
        expect(updatedAccounts).toEqual([portfolioAccount]);
        expect(portfolioAccount.json()).toMatchObject({
            name: 'New ACME',
            type: AccountType.ASSET,
            archived: true,
            groups: [{ id: portfolioGroup.getId() }],
        });
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT New ACME UPDATED"
        );
    });
});
