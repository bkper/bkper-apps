import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { EventHandlerAccount } from '../../../src/events/handlers/EventHandlerAccount.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerAccount extends EventHandlerAccount {
    foundAccount?: Account;
    notFound = false;

    processConnectedBook(
        financialBook: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(financialBook, portfolioBook, event);
    }

    protected async connectedAccountNotFound(): Promise<string> {
        this.notFound = true;
        return 'NOT FOUND';
    }

    protected async connectedAccountFound(
        _financialBook: Book,
        _portfolioBook: Book,
        _financialAccount: bkper.Account,
        portfolioAccount: Account
    ): Promise<string> {
        this.foundAccount = portfolioAccount;
        return 'FOUND';
    }
}

function createHandler(): TestEventHandlerAccount {
    return new TestEventHandlerAccount(new AppContext(new Bkper(), { ASSETS: { fetch } }));
}

function createBook(id: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name: id, properties });
}

function createAccount(name: string, exchangeCode: string): bkper.Account {
    const financialBook = createBook('group-book');
    const group = new Group(financialBook, {
        id: 'exchange-group',
        name: 'Exchange',
        properties: { stock_exc_code: exchangeCode },
    });
    return {
        id: 'financial-account',
        name,
        type: AccountType.ASSET,
        groups: [group.json()],
    };
}

function createEvent(account: bkper.Account): bkper.Event {
    return { data: { object: account } };
}

describe('legacy Account synchronization selection', () => {
    test('does not resolve a Portfolio Account when the exchange does not match', async () => {
        const financialBook = createBook('financial', { exc_code: 'USD' });
        const portfolioBook = createBook('portfolio');
        let accountLookups = 0;
        portfolioBook.getAccount = async () => {
            accountLookups += 1;
            return undefined;
        };
        const handler = createHandler();

        const result = await handler.processConnectedBook(
            financialBook,
            portfolioBook,
            createEvent(createAccount('ACME', 'EUR'))
        );

        expect(result).toBeNull();
        expect(accountLookups).toBe(0);
        expect(handler.foundAccount).toBeUndefined();
        expect(handler.notFound).toBe(false);
    });
});
