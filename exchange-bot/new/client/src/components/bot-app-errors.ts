import type { Book, Permission } from 'bkper-js';
import { appEnv } from '../app-env.js';
import type { AppError, ExchangeBotBook } from '../types.js';
import { VIEW_PERMISSIONS } from '../utils.js';

export const BotAppErrors = {
    bookNotSpecified(): AppError {
        return {
            type: 'info',
            title: 'Book not specified.',
            message: {
                before: 'Verify the bookId param in the URL and try again.',
            },
        };
    },

    bookNotFound(): AppError {
        return {
            type: 'info',
            title: 'Book not found.',
            message: {
                before: 'Verify the bookId param in the URL and try again.',
            },
        };
    },

    bookAccessRequired(bookId: string): AppError {
        return {
            type: 'info',
            title: "You don't have access to this Book.",
            message: {
                action: {
                    label: 'Request access',
                    url: appEnv.getBookUrl(bookId),
                },
                after: 'in Bkper to continue.',
            },
        };
    },

    bookLoadFailed(): AppError {
        return {
            type: 'info',
            title: 'The selected Book could not be loaded.',
            message: {
                before: 'Please try again.',
            },
        };
    },

    appInstallationNotVerified(bookId: string): AppError {
        return {
            type: 'info',
            title: 'Exchange Bot installation could not be verified.',
            message: {
                before: 'Please try again or',
                action: {
                    label: 'install',
                    url: appEnv.getAppUrl(bookId),
                },
                after: 'the Exchange Bot in the Book.',
            },
        };
    },

    insufficientViewPermission(book: Book): AppError {
        return {
            type: 'info',
            title: 'Insufficient Book permission.',
            message: {
                before: formatPermissionError(book.getPermission(), VIEW_PERMISSIONS),
            },
        };
    },

    insufficientEditPermission(books: ExchangeBotBook[]): AppError {
        const identifiers = books.map(b => b.book.getName() ?? b.excCode ?? b.book.getId());
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
