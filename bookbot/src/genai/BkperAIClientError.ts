export class BkperAIClientError extends Error {
    readonly status: number;
    readonly code: string;
    readonly retryable: boolean;

    constructor(status: number, code: string, message: string, retryable: boolean) {
        super(message);
        this.name = 'BkperAIClientError';
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface SafeConnectionErrorDetails {
    name: string;
    message: string;
    cause?: {
        name: string;
        message: string;
        code?: string;
    };
}

function redactSecret(value: string, secret: string | undefined): string {
    const redacted = secret ? value.replaceAll(secret, '[REDACTED]') : value;
    return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

export function getSafeConnectionErrorDetails(
    error: unknown,
    oauthToken: string | undefined
): SafeConnectionErrorDetails {
    const details: SafeConnectionErrorDetails = {
        name: error instanceof Error ? error.name : typeof error,
        message: redactSecret(error instanceof Error ? error.message : 'Unknown fetch failure.', oauthToken),
    };
    const cause = isRecord(error) ? error.cause : undefined;
    if (cause instanceof Error) {
        const code = isRecord(cause) && typeof cause.code === 'string' ? cause.code : undefined;
        details.cause = {
            name: cause.name,
            message: redactSecret(cause.message, oauthToken),
            ...(code ? { code } : {}),
        };
    }
    return details;
}
