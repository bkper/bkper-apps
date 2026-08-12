import type { ApiError } from './api/generated/types.js';

export const Errors = {
    BOOK_NOT_FOUND: 'The Book could not be found. Check the Book link and try again.',
    BOOK_ACCESS_REQUIRED: "You don't have access to this Book.",
    BOOK_LOAD_FAILED: 'The selected Book could not be loaded. Please try again.',
} as const;

export function isApiError(payload: unknown): payload is ApiError {
    if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
        return false;
    }
    const error = payload.error;
    return (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
    );
}

export function isBookAccessRequiredError(error: unknown): boolean {
    const status = getErrorStatus(error);
    const message = getErrorMessage(error);
    return status === 401 && message?.includes('is not a collaborator on the book') === true;
}

export function isNotFoundError(error: unknown): boolean {
    const status = getErrorStatus(error);
    return status === 400 || status === 404;
}

function getErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const code = Reflect.get(error, 'code');
    const status = Reflect.get(error, 'status');
    if (typeof code === 'number') {
        return code;
    }
    return typeof status === 'number' ? status : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const message = Reflect.get(error, 'message');
    return typeof message === 'string' ? message : undefined;
}
