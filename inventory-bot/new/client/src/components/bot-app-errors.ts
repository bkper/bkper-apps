import { Account, Group, type Book, type Permission } from 'bkper-js';
import { appEnv } from '../app-env.js';
import type { AppError } from '../types.js';
import { VIEW_PERMISSIONS } from '../utils.js';

type BookResource = Account | Group;

/** Factories for structured errors displayed by the Inventory Bot application shell. */
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
     * Creates an error for a Book resource that could not be resolved.
     *
     * @param resource - The Book resource that could not be resolved.
     * @param bookName - The name of the Book where the resource was expected.
     * @returns The structured Book-resource-not-found error.
     */
    bookResourceNotFound(resource: BookResource, bookName: string): AppError {
        const type = resolveBookResourceType(resource);
        const identifier = resource.getName() ?? resource.getId() ?? 'unknown';
        return {
            type: 'info',
            title: `${type} not found.`,
            message: {
                before: `${type} ${identifier} could not be found in Book ${bookName}.`,
            },
        };
    },

    /**
     * Creates an error for a Book resource that could not be loaded.
     *
     * @param resource - The Book resource that could not be loaded.
     * @param bookName - The name of the Book containing the resource.
     * @returns The structured Book-resource-loading error.
     */
    bookResourceLoadFailed(resource: BookResource, bookName: string): AppError {
        const type = resolveBookResourceType(resource);
        const identifier = resource.getName() ?? resource.getId() ?? 'unknown';
        return {
            type: 'info',
            title: `${type} could not be loaded.`,
            message: {
                before: `${type} ${identifier} could not be loaded from Book ${bookName}. Please try again.`,
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
     * Creates an error directing the User to install Inventory Bot in a Book.
     *
     * @param bookId - The identifier of the Book whose installation could not be verified.
     * @returns The structured App-installation error.
     */
    appInstallationNotVerified(bookId: string): AppError {
        return {
            type: 'info',
            title: 'Inventory Bot installation could not be verified.',
            message: {
                before: 'Please try again or',
                action: {
                    label: 'install',
                    url: appEnv.getAppUrl(bookId),
                },
                after: 'the Inventory Bot in the Book.',
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
     * Creates an error identifying Books without edit permission.
     *
     * @param bookIdentifiers - The identifiers of the Books that the User cannot edit.
     * @returns The structured edit-permission error.
     */
    insufficientEditPermission(bookIdentifiers: string[]): AppError {
        const prefix = 'User needs EDITOR or OWNER permission in the following books:';
        const suffix = bookIdentifiers.length > 1 ? 'books' : 'book';
        return {
            type: 'error',
            message: {
                before: `${prefix} ${bookIdentifiers.join(', ')} ${suffix}`,
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

function resolveBookResourceType(resource: BookResource): string {
    if (resource instanceof Account) {
        return 'Account';
    } else {
        return 'Group';
    }
}
