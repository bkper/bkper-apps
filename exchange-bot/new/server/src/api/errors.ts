import type { ApiError } from './schemas.js';

export function apiError(message: string): ApiError {
    return { error: { message } };
}
