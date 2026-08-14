import { afterEach, describe, expect, test } from 'bun:test';
import { AccountType, BkperError, Book } from 'bkper-js';
import { optionalLookup } from '../../src/shared/optional-lookup.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('bkper-js server compatibility', () => {
    test('converts an optional SDK 404 lookup to undefined', async () => {
        const book = new Book({ id: 'book-1' });
        let requests = 0;
        globalThis.fetch = (async () => {
            requests += 1;
            return Response.json(
                {
                    error: {
                        code: 404,
                        message: 'Account not found',
                        errors: [{ reason: 'notFound' }],
                    },
                },
                { status: 404 }
            );
        }) as unknown as typeof fetch;

        const result = await optionalLookup(() => book.getAccount('Missing Account'));

        expect(result).toBeUndefined();
        expect(requests).toBe(1);
    });

    test('propagates non-404 lookup errors', async () => {
        const error = new BkperError(403, 'Permission denied', 'forbidden');

        await expect(
            optionalLookup(async () => {
                throw error;
            })
        ).rejects.toBe(error);
    });

    test('resolves embedded Account Groups from a complete Book chart without network requests', async () => {
        const book = new Book({
            id: 'book-1',
            groups: [
                { id: 'group-1', name: 'Cash Groups' },
                { id: 'group-2', name: 'Empty Group' },
            ],
            accounts: [
                {
                    id: 'account-1',
                    name: 'Cash',
                    type: AccountType.ASSET,
                    groups: [{ id: 'group-1' }],
                },
                {
                    id: 'account-2',
                    name: 'Savings',
                    type: AccountType.ASSET,
                    groups: [],
                },
            ],
        });
        let requests = 0;
        globalThis.fetch = (async () => {
            requests += 1;
            throw new Error('A complete chart must resolve Account Groups from the Book cache');
        }) as unknown as typeof fetch;

        const accounts = await book.getAccounts();
        const accountGroups = await Promise.all(accounts.map(account => account.getGroups()));
        const groupAccounts = await Promise.all(
            (await book.getGroups()).map(group => group.getAccounts())
        );

        expect(accountGroups.map(groups => groups.map(group => group.getId()))).toEqual([
            ['group-1'],
            [],
        ]);
        expect(groupAccounts.map(group => group.map(account => account.getId()))).toEqual([
            ['account-1'],
            [],
        ]);
        expect(requests).toBe(0);
    });
});
