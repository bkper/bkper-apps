import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { EventHandlerAccountCreatedOrUpdated } from '../../../src/events/handlers/EventHandlerAccountCreatedOrUpdated.js';
import { EventHandlerAccountDeleted } from '../../../src/events/handlers/EventHandlerAccountDeleted.js';
import { EventHandlerBookUpdated } from '../../../src/events/handlers/EventHandlerBookUpdated.js';
import { EventHandlerGroupCreatedOrUpdated } from '../../../src/events/handlers/EventHandlerGroupCreatedOrUpdated.js';
import { EventHandlerGroupDeleted } from '../../../src/events/handlers/EventHandlerGroupDeleted.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalAccountCreate = Account.prototype.create;
const originalAccountUpdate = Account.prototype.update;
const originalAccountRemove = Account.prototype.remove;
const originalGroupCreate = Group.prototype.create;
const originalGroupUpdate = Group.prototype.update;
const originalGroupRemove = Group.prototype.remove;
const originalConsoleTime = console.time;
const originalConsoleTimeEnd = console.timeEnd;

beforeEach(() => {
    console.time = () => undefined;
    console.timeEnd = () => undefined;
});

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
    Account.prototype.update = originalAccountUpdate;
    Account.prototype.remove = originalAccountRemove;
    Group.prototype.create = originalGroupCreate;
    Group.prototype.update = originalGroupUpdate;
    Group.prototype.remove = originalGroupRemove;
    console.time = originalConsoleTime;
    console.timeEnd = originalConsoleTimeEnd;
});

function createConnectedBooks(): { financialBook: Book; portfolioBook: Book } {
    const financialPayload: bkper.Book = {
        id: 'financial',
        name: 'Financial',
        fractionDigits: 2,
        properties: { exc_code: 'USD' },
    };
    const portfolioPayload: bkper.Book = {
        id: 'portfolio',
        name: 'Portfolio',
        fractionDigits: 0,
        properties: { stock_book: 'true' },
    };
    const collection: bkper.Collection = { books: [financialPayload, portfolioPayload] };
    const financialBook = new Book({ ...financialPayload, collection });
    const portfolioBook = new Book({ ...portfolioPayload, collection });
    const books = [financialBook, portfolioBook];
    financialBook.getCollection()!.getBooks = () => books;
    portfolioBook.getCollection()!.getBooks = () => books;
    return { financialBook, portfolioBook };
}

function createContext(eventBook: Book): AppContext {
    const bkper = new Bkper();
    bkper.getBook = async () => eventBook;
    return new AppContext(bkper, { ASSETS: { fetch } });
}

function createAccountEvent(
    type: 'ACCOUNT_CREATED' | 'ACCOUNT_UPDATED' | 'ACCOUNT_DELETED',
    account: bkper.Account,
    previousName?: string
): bkper.Event {
    return {
        type,
        bookId: 'financial',
        user: { username: 'tester' },
        agent: { id: 'user' },
        data: {
            object: account,
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function createGroupEvent(
    type: 'GROUP_CREATED' | 'GROUP_UPDATED' | 'GROUP_DELETED',
    group: bkper.Group,
    previousName?: string
): bkper.Event {
    return {
        type,
        bookId: 'financial',
        user: { username: 'tester' },
        agent: { id: 'user' },
        data: {
            object: group,
            previousAttributes: previousName ? { name: previousName } : undefined,
        },
    };
}

function createExchangeGroup(book: Book, name = 'NASDAQ'): Group {
    return new Group(book, {
        id: `group-${name}`,
        name,
        hidden: true,
        properties: {
            stock_exc_code: 'USD',
            market: 'technology',
            internal_: 'not-synchronized',
        },
    });
}

function createFinancialAccount(group: Group, name = 'ACME'): bkper.Account {
    return {
        id: 'financial-account',
        name,
        type: AccountType.ASSET,
        archived: false,
        groups: [group.json()],
    };
}

describe('legacy Account synchronization behavior', () => {
    test('creates a missing Portfolio Account and its eligible exchange Group', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
        const financialGroup = createExchangeGroup(financialBook);
        const createdAccounts: Account[] = [];
        const createdGroups: Group[] = [];
        financialBook.getGroup = async id =>
            id === financialGroup.getId() ? financialGroup : undefined;
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
        const account = createFinancialAccount(financialGroup);

        const result = await new EventHandlerAccountCreatedOrUpdated(
            createContext(financialBook)
        ).handleEvent(createAccountEvent('ACCOUNT_CREATED', account));

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
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME CREATED",
        ]);
    });

    test('finds a renamed Account by its previous name and replaces its synchronized fields', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
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
        portfolioBook.getGroup = async name =>
            name === portfolioGroup.getName() ? portfolioGroup : undefined;
        portfolioBook.getAccount = async name => {
            accountLookups.push(name);
            return name === 'Old ACME' ? portfolioAccount : undefined;
        };
        Account.prototype.update = async function (): Promise<Account> {
            updatedAccounts.push(this);
            return this;
        };
        const account = {
            ...createFinancialAccount(financialGroup, 'New ACME'),
            type: AccountType.ASSET,
            archived: true,
        };

        const result = await new EventHandlerAccountCreatedOrUpdated(
            createContext(financialBook)
        ).handleEvent(createAccountEvent('ACCOUNT_UPDATED', account, 'Old ACME'));

        expect(accountLookups).toEqual(['New ACME', 'Old ACME']);
        expect(updatedAccounts).toEqual([portfolioAccount]);
        expect(portfolioAccount.json()).toMatchObject({
            name: 'New ACME',
            type: AccountType.ASSET,
            archived: true,
            groups: [{ id: portfolioGroup.getId() }],
        });
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT New ACME UPDATED",
        ]);
    });

    test('does not synchronize an Account whose exchange does not match its Financial Book', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
        const financialGroup = new Group(financialBook, {
            id: 'group-other-exchange',
            name: 'Other Exchange',
            properties: { stock_exc_code: 'EUR' },
        });
        let accountLookups = 0;
        portfolioBook.getAccount = async () => {
            accountLookups += 1;
            return undefined;
        };

        const result = await new EventHandlerAccountCreatedOrUpdated(
            createContext(financialBook)
        ).handleEvent(
            createAccountEvent('ACCOUNT_CREATED', createFinancialAccount(financialGroup))
        );

        expect(accountLookups).toBe(0);
        expect(result).toEqual({ result: false });
    });

    test('archives a deleted Account with posted movements and removes one without them', async () => {
        const updatedAccounts: Account[] = [];
        const removedAccounts: Account[] = [];
        Account.prototype.update = async function (): Promise<Account> {
            updatedAccounts.push(this);
            return this;
        };
        Account.prototype.remove = async function (): Promise<Account> {
            removedAccounts.push(this);
            return this;
        };

        const results: unknown[] = [];
        for (const hasTransactionPosted of [true, false]) {
            const { financialBook, portfolioBook } = createConnectedBooks();
            const financialGroup = createExchangeGroup(financialBook);
            const portfolioAccount = new Account(portfolioBook, {
                id: `portfolio-${hasTransactionPosted}`,
                name: 'ACME',
                type: AccountType.ASSET,
                hasTransactionPosted,
            });
            portfolioBook.getAccount = async () => portfolioAccount;

            results.push(
                await new EventHandlerAccountDeleted(createContext(financialBook)).handleEvent(
                    createAccountEvent('ACCOUNT_DELETED', createFinancialAccount(financialGroup))
                )
            );
        }

        expect(updatedAccounts).toHaveLength(1);
        expect(updatedAccounts[0].isArchived()).toBe(true);
        expect(removedAccounts).toHaveLength(1);
        expect(removedAccounts[0].hasTransactionPosted()).toBe(false);
        expect(results).toEqual([
            {
                result: [
                    "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME DELETED",
                ],
            },
            {
                result: [
                    "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME DELETED",
                ],
            },
        ]);
    });
});

describe('legacy Group synchronization behavior', () => {
    test('creates a flat Portfolio Group with visible properties only', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
        const financialGroup = createExchangeGroup(financialBook);
        const createdGroups: Group[] = [];
        portfolioBook.getGroup = async () => undefined;
        Group.prototype.create = async function (): Promise<Group> {
            createdGroups.push(this);
            return this;
        };

        const result = await new EventHandlerGroupCreatedOrUpdated(
            createContext(financialBook)
        ).handleEvent(createGroupEvent('GROUP_CREATED', financialGroup.json()));

        expect(createdGroups).toHaveLength(1);
        expect(createdGroups[0].json()).toMatchObject({
            name: 'NASDAQ',
            hidden: true,
            properties: { stock_exc_code: 'USD', market: 'technology' },
        });
        expect(createdGroups[0].getProperty('internal_')).toBeUndefined();
        expect(createdGroups[0].getParent()).toBeUndefined();
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP NASDAQ CREATED",
        ]);
    });

    test('finds a renamed Group by its previous name and updates it without hierarchy synchronization', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
        const portfolioGroup = new Group(portfolioBook, {
            id: 'portfolio-group',
            name: 'Old Market',
            hidden: false,
            properties: { old: 'value' },
        });
        const groupLookups: (string | undefined)[] = [];
        const updatedGroups: Group[] = [];
        portfolioBook.getGroup = async name => {
            groupLookups.push(name);
            return name === 'Old Market' ? portfolioGroup : undefined;
        };
        Group.prototype.update = async function (): Promise<Group> {
            updatedGroups.push(this);
            return this;
        };
        const financialGroup: bkper.Group = {
            id: 'financial-group',
            name: 'New Market',
            hidden: true,
            properties: { stock_exc_code: 'USD', region: 'US' },
            parent: { id: 'financial-parent', name: 'Markets' },
        };

        const result = await new EventHandlerGroupCreatedOrUpdated(
            createContext(financialBook)
        ).handleEvent(createGroupEvent('GROUP_UPDATED', financialGroup, 'Old Market'));

        expect(groupLookups).toEqual(['New Market', 'Old Market']);
        expect(updatedGroups).toEqual([portfolioGroup]);
        expect(portfolioGroup.json()).toMatchObject({
            name: 'New Market',
            hidden: true,
            properties: { stock_exc_code: 'USD', region: 'US' },
        });
        expect(portfolioGroup.getParent()).toBeUndefined();
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP New Market UPDATED",
        ]);
    });

    test('deletes the matching Portfolio Group', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
        const financialGroup = createExchangeGroup(financialBook);
        const portfolioGroup = createExchangeGroup(portfolioBook);
        const removedGroups: Group[] = [];
        portfolioBook.getGroup = async () => portfolioGroup;
        Group.prototype.remove = async function (): Promise<Group> {
            removedGroups.push(this);
            return this;
        };

        const result = await new EventHandlerGroupDeleted(createContext(financialBook)).handleEvent(
            createGroupEvent('GROUP_DELETED', financialGroup.json())
        );

        expect(removedGroups).toEqual([portfolioGroup]);
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP NASDAQ DELETED",
        ]);
    });

    test('preserves the accepted no-mutation response when a deleted Group is absent', async () => {
        const { financialBook, portfolioBook } = createConnectedBooks();
        const financialGroup = createExchangeGroup(financialBook);
        let removals = 0;
        portfolioBook.getGroup = async () => undefined;
        Group.prototype.remove = async function (): Promise<Group> {
            removals += 1;
            return this;
        };

        const result = await new EventHandlerGroupDeleted(createContext(financialBook)).handleEvent(
            createGroupEvent('GROUP_DELETED', financialGroup.json())
        );

        expect(removals).toBe(0);
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: GROUP NASDAQ NOT Found",
        ]);
    });
});

describe('legacy Book synchronization behavior', () => {
    test('copies the historical property and awaits clearing other Portfolio Book flags', async () => {
        const basePayload: bkper.Book = {
            id: 'base',
            name: 'Base',
            fractionDigits: 2,
            properties: { exc_base: 'true', exc_code: 'USD', exc_historical: 'false' },
        };
        const portfolioPayload: bkper.Book = {
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true', stock_historical: 'true' },
        };
        const otherPayload: bkper.Book = {
            id: 'other-portfolio',
            name: 'Other Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        };
        const collection: bkper.Collection = {
            books: [basePayload, portfolioPayload, otherPayload],
        };
        const baseBook = new Book({ ...basePayload, collection });
        const portfolioBook = new Book({ ...portfolioPayload, collection });
        const otherBook = new Book({ ...otherPayload, collection });
        const books = [baseBook, portfolioBook, otherBook];
        for (const book of books) {
            book.getCollection()!.getBooks = () => books;
        }
        const updatedBookIds: string[] = [];
        let otherUpdateStarted = false;
        let releaseOtherUpdate = (): void => undefined;
        const otherUpdateReleased = new Promise<void>(resolve => {
            releaseOtherUpdate = resolve;
        });
        baseBook.update = async (): Promise<Book> => {
            updatedBookIds.push(baseBook.getId());
            return baseBook;
        };
        otherBook.update = async (): Promise<Book> => {
            otherUpdateStarted = true;
            updatedBookIds.push(`${otherBook.getId()}:started`);
            await otherUpdateReleased;
            updatedBookIds.push(`${otherBook.getId()}:completed`);
            return otherBook;
        };

        let handlingSettled = false;
        const handling = new EventHandlerBookUpdated(createContext(portfolioBook))
            .handleEvent({
                type: 'BOOK_UPDATED',
                bookId: portfolioBook.getId(),
                user: { username: 'tester' },
                agent: { id: 'user' },
                data: { object: portfolioBook.json() },
            })
            .then(result => {
                handlingSettled = true;
                return result;
            });
        for (let attempt = 0; attempt < 20 && !otherUpdateStarted && !handlingSettled; attempt++) {
            await Promise.resolve();
        }
        const startedBeforeRelease = otherUpdateStarted;
        const settledBeforeRelease = handlingSettled;
        releaseOtherUpdate();
        const result = await handling;

        expect(startedBeforeRelease).toBe(true);
        expect(settledBeforeRelease).toBe(false);
        expect(otherBook.getProperty('stock_book')).toBeUndefined();
        expect(baseBook.getProperty('exc_historical')).toBe('true');
        expect(updatedBookIds).toEqual([
            'other-portfolio:started',
            'base',
            'other-portfolio:completed',
        ]);
        expect(result.result).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=base'>Base</a>:  exc_historical: true",
        ]);
    });

    test('waits for every launched Book update before propagating a failure', async () => {
        const basePayload: bkper.Book = {
            id: 'base',
            name: 'Base',
            fractionDigits: 2,
            properties: { exc_base: 'true', exc_code: 'USD' },
        };
        const portfolioPayload: bkper.Book = {
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        };
        const failingPayload: bkper.Book = {
            id: 'failing-portfolio',
            name: 'Failing Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        };
        const pendingPayload: bkper.Book = {
            id: 'pending-portfolio',
            name: 'Pending Portfolio',
            fractionDigits: 0,
            properties: { stock_book: 'true' },
        };
        const collection: bkper.Collection = {
            books: [basePayload, portfolioPayload, failingPayload, pendingPayload],
        };
        const baseBook = new Book({ ...basePayload, collection });
        const portfolioBook = new Book({ ...portfolioPayload, collection });
        const failingBook = new Book({ ...failingPayload, collection });
        const pendingBook = new Book({ ...pendingPayload, collection });
        const books = [baseBook, portfolioBook, failingBook, pendingBook];
        for (const book of books) {
            book.getCollection()!.getBooks = () => books;
        }
        const failure = new Error('Book update failed');
        failingBook.update = async (): Promise<Book> => {
            throw failure;
        };
        let pendingUpdateStarted = false;
        let releasePendingUpdate = (): void => undefined;
        const pendingUpdateReleased = new Promise<void>(resolve => {
            releasePendingUpdate = resolve;
        });
        pendingBook.update = async (): Promise<Book> => {
            pendingUpdateStarted = true;
            await pendingUpdateReleased;
            return pendingBook;
        };

        let handlingSettled = false;
        let rejection: unknown;
        const handling = new EventHandlerBookUpdated(createContext(portfolioBook))
            .handleEvent({
                type: 'BOOK_UPDATED',
                bookId: portfolioBook.getId(),
                user: { username: 'tester' },
                agent: { id: 'user' },
                data: { object: portfolioBook.json() },
            })
            .catch(error => {
                rejection = error;
            })
            .finally(() => {
                handlingSettled = true;
            });
        for (let attempt = 0; attempt < 20 && !pendingUpdateStarted; attempt++) {
            await Promise.resolve();
        }
        for (let attempt = 0; attempt < 20 && !handlingSettled; attempt++) {
            await Promise.resolve();
        }
        const settledBeforeRelease = handlingSettled;
        releasePendingUpdate();
        await handling;

        expect(pendingUpdateStarted).toBe(true);
        expect(settledBeforeRelease).toBe(false);
        expect(rejection).toBe(failure);
    });
});
