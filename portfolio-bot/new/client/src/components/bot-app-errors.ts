import type { Book, Permission } from 'bkper-js';
import { appEnv } from '../app-env.js';
import type { AppError, PortfolioBotBook } from '../types.js';
import { VIEW_PERMISSIONS } from '../utils.js';

/** Factories for structured errors displayed by the Portfolio Bot application shell. */
export const BotAppErrors = {
    /**
     * Creates an error for a request without a Book identifier.
     *
     * @returns The structured missing-Book-identifier error.
     */
    bookNotSpecified(): AppError {
        return {
            type: 'info',
            title: 'Book not specified.',
            message: {
                before: 'Verify the bookId param in the URL and try again.',
            },
        };
    },

    /**
     * Creates an error for a Book identifier that could not be resolved.
     *
     * @param bookName - The Book name displayed in the error title.
     * @param guidance - The recovery guidance displayed with the error.
     * @returns The structured Book-not-found error.
     */
    bookNotFound(
        bookName = 'Book',
        guidance = 'Verify the bookId param in the URL and try again.'
    ): AppError {
        return {
            type: 'info',
            title: `${bookName} not found.`,
            message: {
                before: guidance,
            },
        };
    },

    /**
     * Creates an error for an Account that could not be resolved in a Book.
     *
     * @param accountIdentifier - The identifier used to resolve the Account.
     * @param bookIdentifier - The identifier of the Book where the Account was expected.
     * @returns The structured Account-not-found error.
     */
    accountNotFound(accountIdentifier: string, bookIdentifier: string): AppError {
        return {
            type: 'info',
            title: 'Account not found.',
            message: {
                before: `Account ${accountIdentifier} could not be found in Book ${bookIdentifier}.`,
            },
        };
    },

    /**
     * Creates an error for a Group that could not be resolved in a Book.
     *
     * @param groupIdentifier - The identifier used to resolve the Group.
     * @param bookIdentifier - The identifier of the Book where the Group was expected.
     * @returns The structured Group-not-found error.
     */
    groupNotFound(groupIdentifier: string, bookIdentifier: string): AppError {
        return {
            type: 'info',
            title: 'Group not found.',
            message: {
                before: `Group ${groupIdentifier} could not be found in Book ${bookIdentifier}.`,
            },
        };
    },

    /**
     * Creates an error directing the User to request access to a Book.
     *
     * @param bookId - The identifier of the inaccessible Book.
     * @param bookName - The Book name displayed in the error title.
     * @returns The structured Book-access error.
     */
    bookAccessRequired(bookId: string, bookName = 'this Book'): AppError {
        return {
            type: 'info',
            title: `You don't have access to ${bookName}.`,
            message: {
                action: {
                    label: 'Request access',
                    url: appEnv.getBookUrl(bookId),
                },
                after: 'in Bkper to continue.',
            },
        };
    },

    /**
     * Creates an error for a Book that could not be loaded.
     *
     * @param bookName - The Book name displayed in the error title.
     * @returns The structured Book-loading error.
     */
    bookLoadFailed(bookName = 'selected Book'): AppError {
        return {
            type: 'info',
            title: `The ${bookName} could not be loaded.`,
            message: {
                before: 'Please try again.',
            },
        };
    },

    /**
     * Creates an error directing the User to install Portfolio Bot in a Book.
     *
     * @param bookId - The identifier of the Book whose installation could not be verified.
     * @returns The structured App-installation error.
     */
    appInstallationNotVerified(bookId: string): AppError {
        return {
            type: 'info',
            title: 'Portfolio Bot installation could not be verified.',
            message: {
                before: 'Please try again or',
                action: {
                    label: 'install',
                    url: appEnv.getAppUrl(bookId),
                },
                after: 'the Portfolio Bot in the Book.',
            },
        };
    },

    /**
     * Creates an error describing insufficient view permission on a Book.
     *
     * @param book - The Book whose current permission is insufficient.
     * @param bookName - The Book name displayed in the error title.
     * @returns The structured view-permission error.
     */
    insufficientViewPermission(book: Book, bookName = 'Book'): AppError {
        return {
            type: 'info',
            title: `Insufficient ${bookName} permission.`,
            message: {
                before: formatPermissionError(book.getPermission(), VIEW_PERMISSIONS),
            },
        };
    },

    /**
     * Creates an error identifying Book targets without edit permission.
     *
     * @param books - The target Books that the User cannot edit.
     * @returns The structured edit-permission error.
     */
    insufficientEditPermission(books: PortfolioBotBook[]): AppError {
        const identifiers = books.map(b => b.book.getName() ?? b.book.getId());
        const prefix = 'User needs EDITOR or OWNER permission in the following books:';
        const suffix = identifiers.length > 1 ? 'books' : 'book';
        return {
            type: 'error',
            message: {
                before: `${prefix} ${identifiers.join(', ')} ${suffix}`,
            },
        };
    },
};

function formatPermissionError(
    currentPermission: Permission | undefined,
    allowedPermissions: readonly Permission[]
): string {
    const required = formatPermissionList(allowedPermissions);
    const current = currentPermission ?? 'unavailable';
    return `Required Book permission: ${required}. Current: ${current}.`;
}

function formatPermissionList(permissions: readonly Permission[]): string {
    if (permissions.length === 1) {
        return permissions[0];
    }
    if (permissions.length === 2) {
        return `${permissions[0]} or ${permissions[1]}`;
    }
    return `${permissions.slice(0, -1).join(', ')}, or ${permissions.at(-1)}`;
}
