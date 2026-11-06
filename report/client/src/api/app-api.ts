import createClient from 'openapi-fetch';
import type { components, ErrorResponse, paths, PingResponse } from './generated/types';

export type { PingResponse };
export type ApiErrorResponse = ErrorResponse;
export type Suggestion = components['schemas']['Suggestion'];
export type ReportIntent = components['schemas']['ReportIntent'];
export type ReportRequest = components['schemas']['ReportRequest'];
export type ReportResponse = components['schemas']['ReportResponse'];

export interface RequestOptions {
    /** Cancels the request; it then rejects with the `AbortError` of `fetch`. */
    signal?: AbortSignal;
}

export interface AppApiOptions {
    baseUrl?: string;
    fetch: (input: Request) => Promise<Response>;
}

export class AppApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
        /** With `not_a_report`: reports the Book can have. */
        readonly suggestions?: Suggestion[]
    ) {
        super(message);
        this.name = 'AppApiError';
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readApiErrorResponse(value: unknown): ApiErrorResponse | undefined {
    if (!isObject(value) || value.success !== false || !isObject(value.error)) {
        return undefined;
    }

    const code = value.error.code;
    const message = value.error.message;
    if (typeof code !== 'string' || typeof message !== 'string') {
        return undefined;
    }

    if (code.trim().length === 0) {
        return undefined;
    }

    return {
        success: false,
        error: { code, message },
    };
}

function toAppApiError(
    error: unknown,
    response: Response,
    suggestions?: Suggestion[]
): AppApiError {
    const apiError = readApiErrorResponse(error);
    if (apiError) {
        return new AppApiError(
            apiError.error.message,
            response.status,
            apiError.error.code,
            suggestions
        );
    }

    return new AppApiError(`Server API returned ${response.status}`, response.status);
}

function requireData<T>(data: T | undefined, response: Response): T {
    if (data === undefined) {
        throw new AppApiError(
            `Server API returned empty ${response.status} response`,
            response.status
        );
    }
    return data;
}

export function createAppApi(options: AppApiOptions) {
    const client = createClient<paths>({
        baseUrl: options.baseUrl,
        fetch: options.fetch,
    });

    return {
        async ping(): Promise<PingResponse> {
            const { data, error, response } = await client.GET('/api/v1/ping');
            if (error) {
                throw toAppApiError(error, response);
            }
            return requireData(data, response);
        },

        /** Up to three reports the Book can have, with texts in `language`. */
        async suggestions(
            bookId: string,
            options: RequestOptions & { language?: string } = {}
        ): Promise<Suggestion[]> {
            const { data, error, response } = await client.GET(
                '/api/v1/books/{bookId}/suggestions',
                {
                    params: { path: { bookId }, query: { language: options.language } },
                    signal: options.signal,
                }
            );
            if (error) {
                throw toAppApiError(error, response);
            }
            return requireData(data, response).suggestions;
        },

        /**
         * A report of the Book, by `prompt` (one AI decision) or by `intent` (no AI), as a spec:
         * the web client renders it, so it never asks for the HTML file.
         */
        async report(
            bookId: string,
            body: Omit<ReportRequest, 'format'>,
            options: RequestOptions = {}
        ): Promise<ReportResponse> {
            const { data, error, response } = await client.POST('/api/v1/books/{bookId}/report', {
                params: { path: { bookId } },
                body,
                signal: options.signal,
            });
            if (error) {
                const suggestions = 'suggestions' in error ? error.suggestions : undefined;
                throw toAppApiError(error, response, suggestions);
            }
            const report = requireData(data, response);
            if (typeof report === 'string') {
                throw new AppApiError('Server API returned a report file', response.status);
            }
            return report;
        },
    };
}

export type AppApi = ReturnType<typeof createAppApi>;
