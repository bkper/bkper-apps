import { Account, BkperError, Book } from 'bkper-js';

/**
 * Finds an Account by ID or name, returning undefined when the Book has no such Account.
 * `book.getAccount` raises a 404 BkperError for a missing Account instead of returning undefined; other errors still propagate.
 */
export async function findAccount(book: Book, idOrName: string): Promise<Account | undefined> {
    try {
        return await book.getAccount(idOrName);
    } catch (error) {
        if (error instanceof BkperError && error.code === 404) {
            return undefined;
        }
        throw error;
    }
}
