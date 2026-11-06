import { z } from '@hono/zod-openapi';
import { ReportSpecSchema } from 'report-shared/catalog';
import { supportedLanguage } from 'report-shared/languages';
import type { ZodType } from 'zod';
import { ReportIntentSchema } from '../services/report-intent.js';

const JSON_CONTENT_TYPE = 'application/json';

export function jsonResponse<TSchema extends ZodType>(description: string, schema: TSchema) {
    return {
        description,
        content: {
            [JSON_CONTENT_TYPE]: { schema },
        },
    };
}

export const ErrorResponseSchema = z
    .object({
        success: z.literal(false),
        error: z.object({
            code: z.string().min(1).openapi({
                description:
                    'invalid_request, unauthorized, forbidden, not_found, book_not_found, not_a_report, future_period, unknown_root, ai_allowance_exhausted, upstream_error or internal_error.',
                example: 'book_not_found',
            }),
            message: z.string().openapi({ example: 'Book not found, or not shared with you.' }),
        }),
    })
    .openapi('ErrorResponse');

export const PingResponseSchema = z
    .object({
        ok: z.boolean().openapi({ example: true }),
        source: z.string().openapi({ example: 'report' }),
    })
    .openapi('PingResponse');

export const apiErrorResponses = {
    default: jsonResponse('API error', ErrorResponseSchema),
};

/** The 133 Bkper languages, by any BCP 47 tag of theirs, such as `pt-BR` for `pt`. */
const LanguageSchema = z
    .string()
    .max(35)
    .refine(tag => supportedLanguage(tag) !== undefined, {
        message: 'Expected a BCP 47 language tag of a Bkper language',
    })
    .openapi({
        description:
            'Language of the texts, as a BCP 47 tag of one of the Bkper languages, such as `pt` or `pt-BR`.',
        example: 'pt-BR',
    });

export const BookParamsSchema = z.object({
    bookId: z
        .string()
        .min(1)
        .max(200)
        .openapi({
            param: { name: 'bookId', in: 'path' },
            example: 'agtzfmJrcGVyLWhyZHINCxIGTGVkZ2VyGNEPDA',
        }),
});

export const SuggestionsQuerySchema = z.object({
    language: LanguageSchema.optional(),
});

// Schemas made outside this module are named with zod's `meta`: `.openapi` exists only on
// schemas created after @hono/zod-openapi extends zod.
const IntentSchema = ReportIntentSchema.meta({
    id: 'ReportIntent',
    description:
        'What to report: a root group id or `net-result`, a period id (`this_year`, `last_month`, `2025`, `2025-Q3`, `2025-10`, …), whether by month, an optional view and hashtags.',
});

export const SuggestionSchema = z
    .object({
        text: z.string().openapi({ example: 'Expenses by month this year' }),
        intent: IntentSchema,
    })
    .openapi('Suggestion');

export const SuggestionsResponseSchema = z
    .object({ suggestions: z.array(SuggestionSchema) })
    .openapi('SuggestionsResponse');

/** Why a report request is invalid when it has neither or both of `prompt` and `intent`. */
export const EXACTLY_ONE_REQUEST = 'Send exactly one of `prompt` or `intent`.';

// One object rather than a union of the two requests, so that a validation error names the
// field that is wrong instead of the whole body.
export const ReportRequestSchema = z
    .strictObject({
        prompt: z.string().trim().min(1).max(1000).optional().openapi({
            description: 'The report asked for, in any language.',
            example: 'expenses by month this year',
        }),
        intent: IntentSchema.optional(),
        language: LanguageSchema.optional(),
        format: z.enum(['spec']).optional().openapi({
            description: 'What to return; `spec` (the default) is a json-render spec.',
        }),
    })
    .refine(body => (body.prompt === undefined) !== (body.intent === undefined), {
        message: EXACTLY_ONE_REQUEST,
    })
    .openapi('ReportRequest', {
        description:
            'Exactly one of `prompt` (a request in any language) or `intent` (such as a suggestion’s, which needs no AI).',
    });

export type ReportRequestBody = z.infer<typeof ReportRequestSchema>;

export const ReportResponseSchema = z
    .object({
        spec: ReportSpecSchema.meta({
            id: 'ReportSpec',
            description: 'The report as a json-render spec of the report catalog, in `language`.',
        }),
        intent: IntentSchema,
        language: z
            .string()
            .openapi({ description: 'The Bkper language of the texts.', example: 'pt' }),
        query: z.string().openapi({
            description: 'The Bkper query of exactly the report’s transactions and dates.',
            example: "group:'Expenses' after:2026-01-01 before:2026-11-06",
        }),
        dataAt: z.string().openapi({ description: 'When the balances were read (ISO 8601).' }),
        url: z.string().openapi({
            description: 'The report in the Report app.',
            example:
                'https://report.bkper.app/?book=agtzfmJrcGVyLWhyZHINCxIGTGVkZ2VyGNEPDA&q=expenses',
        }),
    })
    .openapi('ReportResponse');

export const ReportErrorResponseSchema = ErrorResponseSchema.extend({
    suggestions: z
        .array(SuggestionSchema)
        .optional()
        .openapi({ description: 'With `not_a_report`: reports this Book can have.' }),
}).openapi('ReportErrorResponse');

export const bookErrorResponses = {
    400: jsonResponse('Invalid request', ErrorResponseSchema),
    403: jsonResponse('No permission to read the Book (`forbidden`)', ErrorResponseSchema),
    404: jsonResponse('Book not found (`book_not_found`)', ErrorResponseSchema),
    502: jsonResponse('Bkper or Bkper AI failed (`upstream_error`)', ErrorResponseSchema),
    ...apiErrorResponses,
};
