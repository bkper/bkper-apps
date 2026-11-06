import { Account, BkperError, Book, File, Group } from 'bkper-js';

/**
 * `bkper-js` lookups raise a 404 BkperError for a resource the Book does not have, instead of returning undefined.
 * These helpers return undefined for that 404; every other error still propagates.
 */
async function undefinedIfNotFound<T>(lookup: Promise<T | undefined>): Promise<T | undefined> {
    try {
        return await lookup;
    } catch (error) {
        if (error instanceof BkperError && error.code === 404) {
            return undefined;
        }
        throw error;
    }
}

/** Finds an Account by ID or name. */
export function findAccount(book: Book, idOrName: string): Promise<Account | undefined> {
    return undefinedIfNotFound(book.getAccount(idOrName));
}

/** Finds a File by ID. */
export function findFile(book: Book, id: string): Promise<File | undefined> {
    return undefinedIfNotFound(book.getFile(id));
}

/** Finds a Group by ID or name. */
export function findGroup(book: Book, idOrName: string): Promise<Group | undefined> {
    return undefinedIfNotFound(book.getGroup(idOrName));
}
