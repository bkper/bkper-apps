import { describe, expect, it, mock } from 'bun:test';
import { Account, BkperError, Book } from 'bkper-js';
import { findAccount } from '../../src/utils/account-utils.js';

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
