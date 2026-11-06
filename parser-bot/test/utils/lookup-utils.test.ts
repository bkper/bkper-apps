import { describe, expect, it, mock } from 'bun:test';
import { Account, BkperError, Book, File, Group } from 'bkper-js';
import { findAccount, findFile, findGroup } from '../../src/utils/lookup-utils.js';

describe('findAccount', () => {
    it('returns the Account the Book finds', async () => {
        const account = { getId: () => 'acc_1' } as unknown as Account;
        const book = { getAccount: mock(async () => account) } as unknown as Book;

        expect(await findAccount(book, 'Bank')).toBe(account);
        expect(book.getAccount).toHaveBeenCalledWith('Bank');
    });

    it('returns undefined when the Book raises a 404 for a missing Account', async () => {
        const book = { getAccount: mock(async () => { throw new BkperError(404, 'Account NOT found!', undefined); }) } as unknown as Book;

        expect(await findAccount(book, 'Missing Account')).toBeUndefined();
    });

    it('propagates every other failure', async () => {
        const forbidden = new BkperError(403, 'Forbidden', undefined);
        const book = { getAccount: mock(async () => { throw forbidden; }) } as unknown as Book;

        await expect(findAccount(book, 'Bank')).rejects.toBe(forbidden);
    });
});

describe('findFile and findGroup', () => {
    it('return what the Book finds', async () => {
        const file = { getId: () => 'file_1' } as unknown as File;
        const group = { getId: () => 'group_1' } as unknown as Group;
        const book = { getFile: mock(async () => file), getGroup: mock(async () => group) } as unknown as Book;

        expect(await findFile(book, 'file_1')).toBe(file);
        expect(await findGroup(book, 'group_1')).toBe(group);
    });

    it('return undefined for a 404 and propagate every other failure', async () => {
        const notFound = new BkperError(404, 'NOT found!', undefined);
        const forbidden = new BkperError(403, 'Forbidden', undefined);
        const missing = { getFile: mock(async () => { throw notFound; }), getGroup: mock(async () => { throw notFound; }) } as unknown as Book;
        const refused = { getFile: mock(async () => { throw forbidden; }), getGroup: mock(async () => { throw forbidden; }) } as unknown as Book;

        expect(await findFile(missing, 'foreign')).toBeUndefined();
        expect(await findGroup(missing, 'foreign')).toBeUndefined();
        await expect(findFile(refused, 'file_1')).rejects.toBe(forbidden);
        await expect(findGroup(refused, 'group_1')).rejects.toBe(forbidden);
    });
});
