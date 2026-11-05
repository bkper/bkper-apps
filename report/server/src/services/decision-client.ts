/**
 * Connector to Bkper AI decision models, through TypeSafe's SDK.
 *
 * In the Worker, platform outbound replaces the placeholder key with the current user's
 * authorization and attributes usage to the app, so the Worker never reads or forwards a user
 * credential. Scripts pass their own token and a `bkper-ai-source` label instead.
 */
import {
    APIConnectionError,
    APIError,
    APITimeoutError,
    TypeSafeClient,
    type Questions,
    type SystemOneRequest,
    type SystemOneResult,
} from '@typesafe-ai/sdk';

// TypeSafe SDK clients call `${baseURL}/v1/systemone`, which Bkper AI serves like `/v1/decisions`.
const AI_BASE_URL = 'https://ai.bkper.app';
const PLATFORM_AUTHORIZATION_PLACEHOLDER = 'bkper-platform-outbound';
const MODEL = 'jev';
/** A report is built while the person types: fail fast rather than wait on a slow attempt. */
const TIMEOUT_MS = 4_000;
const MAX_RETRIES = 1;

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface DecisionClientOptions {
    /** A Bkper token; omit in a Platform Worker. */
    apiKey?: string;
    fetch?: Fetcher;
    headers?: Record<string, string>;
}

export type DecisionClient = Pick<TypeSafeClient, 'systemOne'>;

export function createDecisionClient(options: DecisionClientOptions = {}): DecisionClient {
    const fetcher = options.fetch;
    return new TypeSafeClient({
        apiKey: options.apiKey ?? PLATFORM_AUTHORIZATION_PLACEHOLDER,
        baseURL: AI_BASE_URL,
        defaultModel: MODEL,
        timeout: TIMEOUT_MS,
        retry: { maxRetries: MAX_RETRIES },
        logLevel: 'off',
        ...(options.headers ? { defaultHeaders: options.headers } : {}),
        // The SDK invokes fetch as its own method; Workers' fetch rejects a foreign receiver.
        ...(fetcher ? { fetch: (input: string, init?: RequestInit) => fetcher(input, init) } : {}),
    });
}

/** A Bkper AI failure, with the code of its error envelope (such as `usage_limit_exceeded`). */
export class BkperAiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'BkperAiError';
    }
}

/** Asks the decision model; its failures become {@link BkperAiError}, and an abort stays an abort. */
export async function decide<const Q extends Questions>(
    client: DecisionClient,
    request: SystemOneRequest<Q>,
    signal?: AbortSignal
): Promise<SystemOneResult<Q>> {
    try {
        return await client.systemOne(request, signal ? { signal } : undefined);
    } catch (error) {
        if (error instanceof APIError) {
            const envelope = readErrorEnvelope(error.body);
            throw new BkperAiError(
                error.status,
                envelope?.code ?? 'bkper_ai_error',
                envelope?.message ?? `Bkper AI returned an error (${error.status}).`
            );
        }
        if (error instanceof APITimeoutError) {
            throw new BkperAiError(502, 'timeout', 'Bkper AI did not answer in time.');
        }
        if (error instanceof APIConnectionError) {
            throw new BkperAiError(502, 'connection_error', 'Bkper AI could not be reached.');
        }
        throw error;
    }
}

function readErrorEnvelope(body: unknown): { code: string; message: string } | undefined {
    if (!isRecord(body) || !isRecord(body.error)) {
        return undefined;
    }
    const { code, message } = body.error;
    return typeof code === 'string' && typeof message === 'string' ? { code, message } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
