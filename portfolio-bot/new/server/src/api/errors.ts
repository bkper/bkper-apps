import type { ApiError } from './schemas.js';

export function apiError(message: string): ApiError {
    return { error: { message } };
}

export async function getResponseErrorMessage(response: Response): Promise<string> {
    const fallback = response.statusText || 'Request failed';
    let responseText: string;
    try {
        responseText = (await response.text()).trim();
    } catch {
        return fallback;
    }

    try {
        const error = JSON.parse(responseText) as {
            description?: unknown;
            message?: unknown;
        } | null;
        if (typeof error?.description === 'string' && error.description.trim()) {
            return error.description.trim();
        }
        if (typeof error?.message === 'string' && error.message.trim()) {
            return error.message.trim();
        }
    } catch {
        if (responseText && !responseText.startsWith('<')) {
            return responseText;
        }
    }

    return fallback;
}
