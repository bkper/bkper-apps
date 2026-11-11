import { BkperAIClientError } from './BkperAIClientError.js';

const RETRYABLE_NETWORK_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
]);

function getErrorProperty(error: object, property: string): unknown {
    return Reflect.get(error, property);
}

function hasRetryableNetworkCode(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }

    const code = getErrorProperty(error, 'code');
    if (typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code.toUpperCase())) {
        return true;
    }

    const cause = getErrorProperty(error, 'cause');
    return cause !== error && hasRetryableNetworkCode(cause);
}

export function isTransientGenAIError(error: unknown): boolean {
    if (error instanceof BkperAIClientError) {
        return error.retryable;
    }

    if (hasRetryableNetworkCode(error)) {
        return true;
    }

    return error instanceof TypeError && /fetch|network|connection|socket/i.test(error.message);
}
