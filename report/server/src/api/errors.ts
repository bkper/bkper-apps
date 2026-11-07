import { BkperError } from 'bkper-js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import { BkperAiError } from '../services/decision-client.js';
import { MissingBalancesError, ReportError } from '../services/report.js';
import { NotAReportError } from '../services/report-service.js';
import type { Suggestion } from '../services/suggestions.js';
import { SavedPromptsError } from '../services/saved-prompts.js';

/** The `error.code` of every API error response. */
export type ApiErrorCode =
    | 'invalid_request'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'book_not_found'
    | 'not_a_report'
    | 'future_period'
    | 'unknown_root'
    | 'unknown_target'
    | 'no_net_result'
    | 'ai_allowance_exhausted'
    | 'upstream_error'
    | 'storage_error'
    | 'internal_error';

export function buildApiError(code: ApiErrorCode, message: string) {
    return {
        success: false as const,
        error: { code, message },
    };
}

export type ApiErrorBody = ReturnType<typeof buildApiError> & { suggestions?: Suggestion[] };

export interface ApiErrorResponse {
    status: ContentfulStatusCode;
    body: ApiErrorBody;
}

const HTTP_CODES: Partial<Record<number, ApiErrorCode>> = {
    400: 'invalid_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
};

const REPORT_ERROR_MESSAGES = {
    future_period: 'The period has not started yet.',
    unknown_root:
        'The intent names no root group of this Book, no Account in no group, nor `net-result`.',
    unknown_target:
        'The intent’s target is no group or Account under its root group. Take the intent of a suggestion or of an earlier report, or send the person’s words as `prompt`.',
    no_net_result:
        'This Book has no net result: no group combines its Incoming and Outgoing groups. Tell the person to add one in Bkper (a top-level group holding the income and expense groups), or ask for one of its groups.',
} as const;

/**
 * The typed response of a known failure, or `undefined` for unexpected ones. Messages are
 * the app's own: they never include the request's text or upstream details.
 */
export function apiErrorResponse(error: unknown): ApiErrorResponse | undefined {
    if (error instanceof SavedPromptsError) {
        return error.reason === 'forbidden'
            ? respond(
                  403,
                  'forbidden',
                  'Saved prompts require a known non-NONE Book role to list, and OWNER or EDITOR to save or remove.'
              )
            : respond(
                  502,
                  'storage_error',
                  'Saved-prompt storage failed. Retry the same operation; a failed write may have reached storage.'
              );
    }
    if (error instanceof NotAReportError) {
        return {
            status: 422,
            body: {
                ...buildApiError(
                    'not_a_report',
                    'The request is not a report this Book can have. Name one of its top-level groups, or income versus expenses, and a period; GET /api/v1/books/{bookId}/suggestions lists reports it can have.'
                ),
                suggestions: error.suggestions,
            },
        };
    }
    if (error instanceof ReportError && error.reason !== 'no_activity_roots') {
        return respond(422, error.reason, REPORT_ERROR_MESSAGES[error.reason]);
    }
    if (error instanceof MissingBalancesError) {
        return respond(502, 'upstream_error', 'Bkper failed to answer.');
    }
    if (error instanceof BkperAiError) {
        return error.code === 'usage_limit_exceeded'
            ? respond(
                  429,
                  'ai_allowance_exhausted',
                  'The Bkper AI allowance is used up. Reports by `intent`, such as suggestions, still work.'
              )
            : respond(502, 'upstream_error', 'Bkper AI failed to answer.');
    }
    if (error instanceof BkperError) {
        switch (error.code) {
            // The platform authenticated the caller before the Worker ran, so a Bkper 401 is
            // its answer to a user who is not a collaborator on the Book.
            case 401:
            case 403:
                return respond(403, 'forbidden', 'No permission to read this Book.');
            case 404:
                return respond(404, 'book_not_found', 'Book not found, or not shared with you.');
            default:
                return respond(502, 'upstream_error', 'Bkper failed to answer.');
        }
    }
    if (error instanceof HTTPException) {
        return respond(error.status, HTTP_CODES[error.status] ?? 'internal_error', error.message);
    }
    return undefined;
}

function respond(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string
): ApiErrorResponse {
    return { status, body: buildApiError(code, message) };
}
