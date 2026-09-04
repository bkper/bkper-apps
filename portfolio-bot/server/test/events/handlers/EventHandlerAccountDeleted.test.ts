import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { EventHandlerAccountDeleted } from '../../../src/events/handlers/EventHandlerAccountDeleted.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerAccountDeleted extends EventHandlerAccountDeleted {
    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }
}

const originalAccountUpdate = Account.prototype.update;
const originalAccountRemove = Account.prototype.remove;

afterEach(() => {
    Account.prototype.update = originalAccountUpdate;
    Account.prototype.remove = originalAccountRemove;
});

function createHandler(): TestEventHandlerAccountDeleted {
    return new TestEventHandlerAccountDeleted(new AppContext(new Bkper(), { ASSETS: { fetch } }));
}

function createBook(id: string, name: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name, properties });
}

function createEvent(financialBook: Book): bkper.Event {
    const group = new Group(financialBook, {
        id: 'financial-group',
        name: 'NASDAQ',
        properties: { stock_exc_code: 'USD' },
    });
    return {
        data: {
            object: {
                id: 'financial-account',
                name: 'ACME',
                type: AccountType.ASSET,
                groups: [group.json()],
            },
        },
    };
}

describe('legacy Account deletion synchronization', () => {
    test('archives an Account with posted movements and removes one without them', async () => {
        const updatedAccounts: Account[] = [];
        const removedAccounts: Account[] = [];
        const responses: (string | null)[] = [];
        Account.prototype.update = async function (): Promise<Account> {
            updatedAccounts.push(this);
            return this;
        };
        Account.prototype.remove = async function (): Promise<Account> {
            removedAccounts.push(this);
            return this;
        };

        for (const hasTransactionPosted of [true, false]) {
            const financialBook = createBook('financial', 'Financial', { exc_code: 'USD' });
            const portfolioBook = createBook('portfolio', 'Portfolio');
            const portfolioAccount = new Account(portfolioBook, {
                id: `portfolio-${hasTransactionPosted}`,
                name: 'ACME',
                type: AccountType.ASSET,
                hasTransactionPosted,
            });
            portfolioBook.getAccount = async () => portfolioAccount;

            responses.push(
                await createHandler().processConnectedBook(
                    financialBook,
                    portfolioBook,
                    createEvent(financialBook)
                )
            );
        }

        expect(updatedAccounts).toHaveLength(1);
        expect(updatedAccounts[0].isArchived()).toBe(true);
        expect(removedAccounts).toHaveLength(1);
        expect(removedAccounts[0].hasTransactionPosted()).toBe(false);
        expect(responses).toEqual([
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME DELETED",
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME DELETED",
        ]);
    });

    test('returns the missing-Account response and skips unmatched exchanges', async () => {
        const mutations: string[] = [];
        Account.prototype.update = async function (): Promise<Account> {
            mutations.push(`update:${this.getName()}`);
            return this;
        };
        Account.prototype.remove = async function (): Promise<Account> {
            mutations.push(`remove:${this.getName()}`);
            return this;
        };

        const matchedFinancialBook = createBook('financial', 'Financial', {
            exc_code: 'USD',
        });
        const portfolioBook = createBook('portfolio', 'Portfolio');
        const lookups: string[] = [];
        portfolioBook.getAccount = async name => {
            lookups.push(name ?? '');
            return undefined;
        };
        const missingResult = await createHandler().processConnectedBook(
            matchedFinancialBook,
            portfolioBook,
            createEvent(matchedFinancialBook)
        );

        const unmatchedFinancialBook = createBook('financial-eur', 'Financial EUR', {
            exc_code: 'EUR',
        });
        const unmatchedResult = await createHandler().processConnectedBook(
            unmatchedFinancialBook,
            portfolioBook,
            createEvent(unmatchedFinancialBook)
        );

        expect(lookups).toEqual(['ACME']);
        expect(mutations).toEqual([]);
        expect(missingResult).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=portfolio'>Portfolio</a>: ACCOUNT ACME NOT Found"
        );
        expect(unmatchedResult).toBeNull();
    });
});
