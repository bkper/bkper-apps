import { BkperError } from 'bkper-js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import type { BookProblem } from '../services/book-problems.js';
import { BkperAiError } from '../services/decision-client.js';
import { MissingBalancesError, ReportError } from '../services/report.js';
import { NotAReportError } from '../services/report-service.js';
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
    | 'mixed_targets'
    | 'no_net_result'
    | 'empty_book'
    | 'nothing_to_report'
    | 'mixed_group'
    | 'ai_allowance_exhausted'
    | 'upstream_error'
    | 'storage_error'
    | 'prompt_not_found'
    | 'shelf_changed'
    | 'internal_error';

export function buildApiError(code: ApiErrorCode, message: string) {
    return {
        success: false as const,
        error: { code, message },
    };
}

export type ApiErrorBody = ReturnType<typeof buildApiError> & {
    suggestions?: string[];
    problem?: BookProblem;
};

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

/** What an agent can offer when organizing the Book's groups would let it have the report. */
const ORGANIZE =
    'If the person is the Book’s OWNER or EDITOR (`problem.canOrganize`), offer to organize its groups for them, changing groups only, never transactions; otherwise, tell them to ask the Book’s owner. `problem` names what is involved.';

const REPORT_ERROR_MESSAGES = {
    future_period: 'The period has not started yet.',
    unknown_root:
        'The group or Account asked for is not in this Book. Send the person’s words, or a suggestion, as `prompt`.',
    unknown_target:
        'The group or Account asked for is not in this Book. Send the person’s words, or a suggestion, as `prompt`.',
    mixed_targets:
        'Balances at a date (Asset, Liability) and activity in a period (Incoming, Outgoing) cannot be side by side. Ask for them in separate reports.',
    no_net_result: `This Book has no net result: no group combines its Incoming and Outgoing groups, or its activity groups share Accounts. Reports of one of its groups still work. To have a net result, income and expenses must meet in one top-level group. ${ORGANIZE}`,
    empty_book:
        'This Book has no transactions yet, so there is nothing to report. If the person is the Book’s OWNER or EDITOR (`problem.canOrganize`), offer to help them get started recording its transactions.',
    nothing_to_report: `This Book has nothing to report on: it has no groups, or most of its Accounts with transactions are in no group, and reports read groups. Organizing its Accounts into groups, such as a balance sheet and an income statement, lets it have reports. ${ORGANIZE}`,
    mixed_group: `The group asked for holds both balances (Asset, Liability) and activity (Incoming, Outgoing), so its report would mix them. Reports of its subgroups or Accounts still work. Separating them into groups of their own lets it have the report. ${ORGANIZE}`,
} as const;

const SAVED_PROMPT_ERRORS = {
    forbidden: [
        403,
        'Saved prompts require a known non-NONE Book role to list, and OWNER or EDITOR to save, remove or move.',
    ],
    storage_error: [
        502,
        'Saved-prompt storage failed. Retry the same operation; a failed write may have reached storage.',
    ],
    prompt_not_found: [404, 'This saved prompt is not on the Book’s shelf. List the shelf again.'],
    shelf_changed: [
        409,
        'The shelf changed: the saved prompt to move before is no longer on it. List the shelf again and retry with its current order.',
    ],
} as const satisfies Record<SavedPromptsError['reason'], readonly [ContentfulStatusCode, string]>;

/**
 * The typed response of a known failure, or `undefined` for unexpected ones. Messages are
 * the app's own: they never include the request's text or upstream details.
 */
export function apiErrorResponse(error: unknown): ApiErrorResponse | undefined {
    if (error instanceof SavedPromptsError) {
        const [status, message] = SAVED_PROMPT_ERRORS[error.reason];
        return respond(status, error.reason, message);
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
        const response = respond(422, error.reason, REPORT_ERROR_MESSAGES[error.reason]);
        return error.problem
            ? { ...response, body: { ...response.body, problem: error.problem } }
            : response;
    }
    if (error instanceof MissingBalancesError) {
        return respond(502, 'upstream_error', 'Bkper failed to answer.');
    }
    if (error instanceof BkperAiError) {
        return error.code === 'usage_limit_exceeded'
            ? respond(
                  429,
                  'ai_allowance_exhausted',
                  'The Bkper AI allowance is used up. Suggestions sent as they are still work.'
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
