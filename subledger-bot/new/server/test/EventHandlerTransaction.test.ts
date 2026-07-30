import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandlerTransaction } from '../src/events/handlers/EventHandlerTransaction';

class AccountMappingHandler extends EventHandlerTransaction {
    resolveParentAccount(
        childBook: Book,
        parentBook: Book,
        childAccount: Account
    ): Promise<Account | null | undefined> {
        return this.getParentAccount(childBook, parentBook, childAccount);
    }
}

function createBook(id: string, name: string): Book {
    return new Book({ id, name });
}

function createAccount(
    book: Book,
    id: string,
    name: string,
    properties: Record<string, string> = {}
): Account {
    return new Account(book, {
        id,
        name,
        type: AccountType.ASSET,
        properties,
    });
}

function createGroup(
    book: Book,
    id: string,
    name: string,
    properties: Record<string, string> = {}
): Group {
    return new Group(book, {
        id,
        name,
        type: AccountType.ASSET,
        properties,
    });
}

function createHandler(): AccountMappingHandler {
    return new AccountMappingHandler(new AppContext(new Bkper()));
}

describe('legacy parent Account mapping', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('uses the direct parent_account mapping before Groups or same-name fallback', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const directParent = createAccount(parentBook, 'direct-parent', 'Direct Parent');
        const childAccount = createAccount(childBook, 'child-account', 'Customer A', {
            parent_account: 'Direct Parent',
        });
        let groupReads = 0;
        childAccount.getGroups = async () => {
            groupReads += 1;
            return [
                createGroup(childBook, 'mapped-group', 'Customers', {
                    parent_account: 'Group Parent',
                }),
            ];
        };
        const accountLookups: (string | undefined)[] = [];
        parentBook.getAccount = async name => {
            accountLookups.push(name);
            return name === 'Direct Parent' ? directParent : undefined;
        };

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result).toBe(directParent);
        expect(accountLookups).toEqual(['Direct Parent']);
        expect(groupReads).toBe(0);
    });

    test('does not fall through when a direct parent_account target is missing', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childAccount = createAccount(childBook, 'child-account', 'Customer A', {
            parent_account: 'Missing Parent',
        });
        let groupReads = 0;
        childAccount.getGroups = async () => {
            groupReads += 1;
            return [];
        };
        parentBook.getAccount = async name =>
            name === 'Customer A'
                ? createAccount(parentBook, 'same-name', 'Customer A')
                : undefined;

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result).toBeUndefined();
        expect(groupReads).toBe(0);
    });

    test('uses a Group parent_account mapping before linked-Group lookup', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const groupParent = createAccount(parentBook, 'group-parent', 'Receivables');
        const mappedGroup = createGroup(childBook, 'mapped-group', 'Customers', {
            parent_account: 'Receivables',
        });
        const childAccount = createAccount(childBook, 'child-account', 'Customer A');
        childAccount.getGroups = async () => [mappedGroup];
        parentBook.getAccount = async name => (name === 'Receivables' ? groupParent : undefined);
        let groupLookups = 0;
        parentBook.getGroup = async () => {
            groupLookups += 1;
            return undefined;
        };

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result).toBe(groupParent);
        expect(groupLookups).toBe(0);
    });

    test('auto-creates a missing Group-mapped parent Account with the Group type', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const mappedGroup = createGroup(childBook, 'mapped-group', 'Customers', {
            parent_account: 'Receivables',
        });
        const childAccount = createAccount(childBook, 'child-account', 'Customer A');
        childAccount.getGroups = async () => [mappedGroup];
        parentBook.getAccount = async () => undefined;
        const requests: Request[] = [];
        globalThis.fetch = Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const request = input instanceof Request ? input : new Request(input, init);
                requests.push(request);
                return new Response(
                    JSON.stringify({
                        id: 'created-parent',
                        name: 'Receivables',
                        type: AccountType.ASSET,
                    }),
                    { headers: { 'content-type': 'application/json' } }
                );
            },
            { preconnect: originalFetch.preconnect }
        );

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result?.getId()).toBe('created-parent');
        expect(result?.getName()).toBe('Receivables');
        expect(result?.getType()).toBe(AccountType.ASSET);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://api.bkper.app/v5/books/parent-book/accounts?');
        expect(await requests[0].clone().json()).toMatchObject({
            name: 'Receivables',
            type: AccountType.ASSET,
        });
        expect(requests[0].url).not.toContain('/transactions');
    });

    test('uses the same-name parent Account through a linked Group', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childGroup = createGroup(childBook, 'child-group', 'Revenue');
        const linkedParentGroup = createGroup(parentBook, 'parent-group', 'Revenue', {
            child_book_id: 'child-book',
        });
        const sameNameParent = createAccount(parentBook, 'same-name', 'Service A');
        const childAccount = createAccount(childBook, 'child-account', 'Service A');
        childAccount.getGroups = async () => [childGroup];
        parentBook.getGroup = async name => (name === 'Revenue' ? linkedParentGroup : undefined);
        parentBook.getAccount = async name => (name === 'Service A' ? sameNameParent : undefined);

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result).toBe(sameNameParent);
    });

    test('falls back to a same-name parent Account without a mapping', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const sameNameParent = createAccount(parentBook, 'same-name', 'Service A');
        const childAccount = createAccount(childBook, 'child-account', 'Service A');
        childAccount.getGroups = async () => [];
        parentBook.getAccount = async name => (name === 'Service A' ? sameNameParent : undefined);

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result).toBe(sameNameParent);
    });

    test('returns undefined when no parent Account mapping resolves', async () => {
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childAccount = createAccount(childBook, 'child-account', 'Missing Account');
        childAccount.getGroups = async () => [];
        parentBook.getAccount = async () => undefined;

        const result = await createHandler().resolveParentAccount(
            childBook,
            parentBook,
            childAccount
        );

        expect(result).toBeUndefined();
    });
});
