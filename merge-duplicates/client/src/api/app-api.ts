import createClient from 'openapi-fetch';
import type {
    AnalyzeRequest,
    AnalyzeResponse,
    ErrorResponse,
    LearnRequest,
    LearnResponse,
    MergeRequest,
    MergeResponse,
    paths,
    SkippedCounts,
    Suggestion,
    Transaction,
} from './generated/types';

export type {
    AnalyzeRequest,
    AnalyzeResponse,
    LearnRequest,
    LearnResponse,
    MergeRequest,
    MergeResponse,
    SkippedCounts,
    Suggestion,
    Transaction,
};

export interface AppApiOptions {
    baseUrl?: string;
    fetch: (input: Request) => Promise<Response>;
}

export class AppApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string
    ) {
        super(message);
        this.name = 'AppApiError';
    }
}

export function createAppApi(options: AppApiOptions) {
    const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: options.fetch });

    return {
        async analyze(request: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
            const { data, error, response } = await client.POST('/api/v1/analyze', {
                body: request,
                signal,
            });
            return unwrap(data, error, response);
        },
        async merge(request: MergeRequest): Promise<MergeResponse> {
            const { data, error, response } = await client.POST('/api/v1/merge', {
                body: request,
            });
            return unwrap(data, error, response);
        },
        async learn(request: LearnRequest): Promise<LearnResponse> {
            const { data, error, response } = await client.POST('/api/v1/learn', {
                body: request,
            });
            return unwrap(data, error, response);
        },
    };
}

export type AppApi = ReturnType<typeof createAppApi>;

function unwrap<T>(data: T | undefined, error: unknown, response: Response): T {
    if (error !== undefined) {
        const apiError = readError(error);
        throw new AppApiError(
            apiError?.error.message ?? `Server API returned ${response.status}.`,
            response.status,
            apiError?.error.code
        );
    }
    if (data === undefined) {
        throw new AppApiError(
            `Server API returned an empty ${response.status} response.`,
            response.status
        );
    }
    return data;
}

function readError(value: unknown): ErrorResponse | undefined {
    if (!isRecord(value) || value.success !== false || !isRecord(value.error)) return undefined;
    if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string')
        return undefined;
    return { success: false, error: { code: value.error.code, message: value.error.message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
