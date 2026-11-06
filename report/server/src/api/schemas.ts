import { z } from '@hono/zod-openapi';
import { ReportSpecSchema } from 'report-shared/catalog';
import { supportedLanguage } from 'report-shared/languages';
import type { ZodType } from 'zod';
import { CHART_KINDS } from '../services/report.js';
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
            code: z
                .string()
                .min(1)
                .openapi({
                    description: [
                        'What failed:',
                        '`invalid_request` (400, the message names the field),',
                        '`unauthorized` (401, no valid Bkper token),',
                        '`forbidden` (403, the person cannot view the Book),',
                        '`not_found` (404, no such API route),',
                        '`book_not_found` (404, no such Book, or not shared with the person),',
                        '`not_a_report` (422, the request names nothing this Book can report: ask for a root group or income versus expenses with a period, or use a suggestion),',
                        '`future_period` (422, the period has not started),',
                        '`unknown_root` (422, the intent names no root group of the Book),',
                        '`ai_allowance_exhausted` (429, the person’s Bkper AI allowance is used up: requests by `intent` still work),',
                        '`upstream_error` (502, Bkper or Bkper AI failed: try again) or',
                        '`internal_error` (500).',
                    ].join(' '),
                    example: 'book_not_found',
                }),
            message: z.string().openapi({
                description:
                    'What failed, in English, for people and logs. Never the request text.',
                example: 'Book not found, or not shared with you.',
            }),
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
    default: jsonResponse(
        'Another error, such as `unauthorized` (401) or `internal_error` (500)',
        ErrorResponseSchema
    ),
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
            'Language of the texts, as a BCP 47 tag of one of the 133 Bkper languages, such as `pt` or `pt-BR`.',
        example: 'pt-BR',
    });

export const BookParamsSchema = z.object({
    bookId: z
        .string()
        .min(1)
        .max(200)
        .openapi({
            param: {
                name: 'bookId',
                in: 'path',
                description: 'Id of the Book, as Bkper gives it (`bkper book list`).',
            },
            example: 'abc123',
        }),
});

export const SuggestionsQuerySchema = z.object({
    language: LanguageSchema.optional().openapi({
        description:
            'Language of the suggestions’ texts, as a BCP 47 tag of one of the 133 Bkper languages. Default: `Accept-Language`, else English.',
    }),
});

// Schemas made outside this module are named with zod's `meta`: `.openapi` exists only on
// schemas created after @hono/zod-openapi extends zod.
const { shape } = ReportIntentSchema;
const IntentSchema = ReportIntentSchema.extend({
    root: shape.root.meta({
        description:
            'Id of a root (top-level) group of the Book, as in `bkper group list`, or `net-result` for income versus expenses (every Incoming root versus every Outgoing root).',
        example: 'net-result',
    }),
    period: shape.period.meta({
        description:
            'The period, in the Book’s time zone: `today`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_year`, `ytd`, `last_12_months`, `all`, a year (`2025`), a quarter (`2025-Q3`) or a month (`2025-10`). Current periods end today; past ones are whole calendar periods.',
        example: 'this_year',
    }),
    monthly: shape.monthly.meta({ description: 'Show the period month by month.' }),
    view: shape.view.meta({
        description:
            'The layout asked for: `trend` (over time), `breakdown` (by subgroups and Accounts) or `total` (the amount alone). Left out, the report picks one.',
    }),
    chart: shape.chart.meta({
        description:
            'The chart the person asked for: `pie` (the parts of the total), `stacked` (the parts by month), `area` (by month), `compare` (each part against the previous period), `waterfall` (a bridge: from Incoming to the net result through each Outgoing Account, or from the previous position through each part’s change), `table` (no chart) or `auto`. Left out or `auto`, the report picks one; a chart that does not fit the report falls back to the one the report picks (see the response’s `chart`).',
        example: 'pie',
    }),
    hashtags: shape.hashtags.meta({
        description: 'Only transactions with all these hashtags, without `#`.',
        example: ['travel'],
    }),
}).meta({
    id: 'ReportIntent',
    description:
        'Exactly what to report, with no AI needed: a root group or `net-result`, a period, whether by month, an optional view, chart and hashtags. Take it from a suggestion or from an earlier report’s `intent`.',
});

export const SuggestionSchema = z
    .object({
        text: z.string().openapi({
            description: 'The report as a person would ask for it, in the requested language.',
            example: 'Expenses by month this year',
        }),
        intent: IntentSchema,
    })
    .openapi('Suggestion', {
        description:
            'A report this Book can have. Send its `intent` to `POST /api/v1/books/{bookId}/report` to build it without AI.',
    });

export const SuggestionsResponseSchema = z
    .object({
        suggestions: z.array(SuggestionSchema).openapi({
            description: 'Up to three reports, chosen from the Book’s own groups and data.',
        }),
    })
    .openapi('SuggestionsResponse');

/** Why a report request is invalid when it has neither or both of `prompt` and `intent`. */
export const EXACTLY_ONE_REQUEST = 'Send exactly one of `prompt` or `intent`.';

// One object rather than a union of the two requests, so that a validation error names the
// field that is wrong instead of the whole body.
export const ReportRequestSchema = z
    .strictObject({
        prompt: z.string().trim().min(1).max(1000).optional().openapi({
            description:
                'The report the person asked for, in their own words and language: do not translate it. Include what they said about the period, the view and `#hashtags`; leave out the Book’s name or id, which the path gives. Uses one Bkper AI decision.',
            example: 'show my expenses by category this year',
        }),
        intent: IntentSchema.optional(),
        language: LanguageSchema.optional().openapi({
            description:
                'Language of the report’s texts, as a BCP 47 tag of one of the 133 Bkper languages, such as `pt` or `pt-BR`. Leave it out to write the report in the language of `prompt`, else `Accept-Language`, else English.',
        }),
        format: z.enum(['spec', 'html']).optional().openapi({
            description:
                'What to return. `html` to show the report to a person: one self-contained, interactive HTML file (`text/html`) that loads nothing and links to the report in the Report app; save it and publish or share it as it is. `spec` (the default) for JSON: the report as a json-render spec with its intent, language, query, data time and link.',
            example: 'html',
        }),
    })
    .refine(body => (body.prompt === undefined) !== (body.intent === undefined), {
        message: EXACTLY_ONE_REQUEST,
    })
    .openapi('ReportRequest', {
        description:
            'Exactly one of `prompt` (the person’s request, in any language) or `intent` (from a suggestion or an earlier report, with no AI). Usually `{ "prompt": "…", "format": "html" }`.',
    });

export type ReportRequestBody = z.infer<typeof ReportRequestSchema>;

export const ReportResponseSchema = z
    .object({
        spec: ReportSpecSchema.meta({
            id: 'ReportSpec',
            description:
                'The report as a flat json-render spec (`root` and `elements`) of the Report catalog, every text in `language`: `Report` (title, period) holds `Answer` (amount, previous period amount and change; for a net result, Incoming and Outgoing), `Chart` (when one fits), `BreakdownTable` (rows of subgroups and Accounts with amount, share and change, nested) and `Source`. Amounts and ratios are exact decimal strings; months and instants are ISO.',
        }),
        intent: IntentSchema,
        language: z.string().openapi({
            description: 'The Bkper language of the report’s texts.',
            example: 'pt',
        }),
        query: z.string().openapi({
            description:
                'The Bkper query of exactly the report’s transactions and dates, to list them or check balances in Bkper.',
            example: "group:'Expenses' after:2026-01-01 before:2026-11-06",
        }),
        dataAt: z.string().openapi({
            description:
                'When the balances were read (ISO 8601); they may be up to 60 seconds old.',
            example: '2026-11-05T14:03:12.345Z',
        }),
        chart: z
            .object({
                kind: z.enum(CHART_KINDS).openapi({
                    description:
                        'The chart in the spec: `bar`, `line`, `area` or `stacked` by month; `ranked-bar`, `donut` or `pie` of the parts; `compare` (each part against the previous period); `waterfall` (a bridge); `none` for no chart.',
                    example: 'pie',
                }),
                fallback: z.boolean().openapi({
                    description:
                        'True when the intent’s `chart` does not fit this report, so `kind` is the chart the report picks instead.',
                    example: false,
                }),
            })
            .openapi({ description: 'The chart drawn, and whether the one asked for fit.' }),
        url: z.string().openapi({
            description: 'The same report in the Report app, to open or share with the person.',
            example: 'https://report.bkper.app/?book=abc123&q=expenses+by+month+this+year',
        }),
    })
    .openapi('ReportResponse', { description: 'The report, with `format: spec`.' });

export const ReportFileSchema = z.string().openapi({
    description:
        'With `format: html`: a self-contained, interactive HTML document of the report, in `language`. Every script and style is inline and it loads nothing, so it works in a sandboxed frame: the chart shows tooltips, rows open in place, and a link opens the report in the Report app (shown by the Bkper Agent in a Book, in place of the Agent).',
    example: '<!doctype html>\n<html lang="en" dir="ltr">…',
});

export const ReportErrorResponseSchema = ErrorResponseSchema.extend({
    suggestions: z.array(SuggestionSchema).optional().openapi({
        description:
            'With `not_a_report`: reports this Book can have, to offer the person instead.',
    }),
}).openapi('ReportErrorResponse');

export const bookErrorResponses = {
    400: jsonResponse('Invalid request (`invalid_request`, naming the field)', ErrorResponseSchema),
    403: jsonResponse('The person cannot view the Book (`forbidden`)', ErrorResponseSchema),
    404: jsonResponse(
        'Book not found, or not shared with the person (`book_not_found`)',
        ErrorResponseSchema
    ),
    502: jsonResponse(
        'Bkper or Bkper AI failed; try again (`upstream_error`)',
        ErrorResponseSchema
    ),
    ...apiErrorResponses,
};
