/**
 * The evaluation only reads Books. bkper-js sends every Book call through the global fetch, so this
 * guard refuses any request that is not a read, except to Bkper AI, which receives the model calls.
 */

const BKPER_AI_HOST = 'ai.bkper.app';
const READ_METHODS = new Set(['GET', 'HEAD']);

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
    return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestUrl(input: string | URL | Request): URL {
    return new URL(input instanceof Request ? input.url : input.toString());
}

export function isAllowedRequest(input: string | URL | Request, init?: RequestInit): boolean {
    return READ_METHODS.has(requestMethod(input, init)) || requestUrl(input).host === BKPER_AI_HOST;
}

export function readOnlyFetch(fetcher: typeof fetch): typeof fetch {
    const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (!isAllowedRequest(input, init)) {
            throw new Error(`Read-only evaluation refused ${requestMethod(input, init)} ${requestUrl(input).origin}`);
        }
        return fetcher(input, init);
    };
    return Object.assign(guarded, { preconnect: fetcher.preconnect });
}

/** Installs the guard for this process; call it before creating any Bkper client. */
export function installReadOnlyGuard(): void {
    globalThis.fetch = readOnlyFetch(globalThis.fetch);
}
