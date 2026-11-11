import { z } from '@hono/zod-openapi';
import { ReportSpecSchema } from 'report-shared/catalog';
import { supportedLanguage } from 'report-shared/languages';
import type { ZodType } from 'zod';
import { CHART_KINDS } from '../services/report.js';
import { ReportPromptSchema, ReportQuerySchema } from '../services/report-prompt.js';

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
                        '`not_a_report` (422, the request names nothing this Book can report: ask for a root group or income versus expenses with a period, or send a suggestion),',
                        '`query_not_a_report` (422, the `query`, or a `prompt` read as one, names no group or Account of the Book, or none Bkper finds),',
                        '`future_period` (422, the period has not started),',
                        '`mixed_targets` (422, the groups or Accounts the prompt names side by side mix balances at a date, Asset and Liability, with activity in a period, Incoming and Outgoing: ask for them in separate reports),',
                        '`no_net_result` (422, the Book has no net result: no group combines its Incoming and Outgoing groups, or its activity groups share Accounts; organizing its groups fixes it),',
                        '`empty_book` (422, the Book has no transactions yet),',
                        '`nothing_to_report` (422, the Book has no groups, or most of its Accounts with transactions are in no group; organizing them into groups fixes it),',
                        '`mixed_group` (422, the group asked for holds both balances, Asset or Liability, and activity, Incoming or Outgoing; separating them into groups of their own fixes it),',
                        '`ai_allowance_exhausted` (429, the person’s Bkper AI allowance is used up: suggestions sent as they are still work),',
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

/** A suggested report: a request as a person would type it, built without AI. */
const SuggestionSchema = z.string().openapi({
    description:
        'A report this Book can have, as a person would ask for it, in the language of the suggestions. Send it as `prompt` to `POST /api/v1/books/{bookId}/report`, with the same `language`: exactly this text (spacing aside, case kept) builds it with no AI.',
    example: 'Expenses by month this year',
});

const ProblemBaseSchema = z.object({
    bookName: z.string().openapi({
        description: 'The Book’s name, as Bkper writes it.',
        example: 'My Company',
    }),
    canOrganize: z.boolean().openapi({
        description:
            'Whether the person may change the Book’s groups (OWNER or EDITOR), so they, or an agent for them, can fix it. Otherwise only the Book’s owner can.',
        example: true,
    }),
});

export const BookProblemSchema = z
    .discriminatedUnion('code', [
        ProblemBaseSchema.extend({
            code: z.literal('empty_book').openapi({
                description: 'No Account of the Book has transactions yet.',
            }),
        }),
        ProblemBaseSchema.extend({
            code: z.literal('nothing_to_report').openapi({
                description:
                    'The Book has no groups, or more than half of its Accounts with transactions are in no group.',
            }),
            ungrouped: z.number().int().min(0).openapi({
                description: 'Accounts with transactions that are in no group.',
                example: 12,
            }),
            total: z.number().int().min(1).openapi({
                description: 'Accounts with transactions.',
                example: 15,
            }),
        }),
        ProblemBaseSchema.extend({
            code: z.literal('no_net_result').openapi({
                description:
                    'No group combines the Book’s Incoming and Outgoing groups, and its activity groups cannot be netted: they share Accounts, or some hold neither kind alone.',
            }),
            incoming: z.array(z.string()).openapi({
                description:
                    'Names of the activity root groups holding Incoming Accounts, in Book order.',
                example: ['Revenue'],
            }),
            outgoing: z.array(z.string()).openapi({
                description:
                    'Names of the activity root groups holding Outgoing Accounts, in Book order.',
                example: ['Expenses'],
            }),
            shared: z.array(z.string()).openapi({
                description:
                    'Names of the activity root groups that share Accounts with another, in Book order; empty when none do.',
                example: [],
            }),
        }),
        ProblemBaseSchema.extend({
            code: z.literal('mixed_group').openapi({
                description:
                    'The group asked for holds Accounts with transactions of both balances (Asset, Liability) and activity (Incoming, Outgoing).',
            }),
            group: z.string().openapi({
                description: 'Name of the group.',
                example: 'Company',
            }),
        }),
    ])
    .openapi('BookProblem', {
        description:
            'Why the Book cannot have the report, found by fixed rules from its groups and Accounts, and what is involved. Every case but `empty_book` is fixed by organizing the Book’s groups, never its transactions.',
    });

export const SuggestionsResponseSchema = z
    .object({
        suggestions: z.array(SuggestionSchema).openapi({
            description:
                'Up to three reports of the Book’s own groups, the main one first; none with a `problem`.',
        }),
        problem: BookProblemSchema.optional(),
    })
    .openapi('SuggestionsResponse', {
        description:
            'Suggested reports; or, when the Book has no reports at all, none and `problem`: `empty_book` (no transactions yet) or `nothing_to_report` (no groups to report on). Every report request of that Book then answers the same 422 error.',
    });

export const BookNameSchema = z
    .object({
        id: z.string().openapi({
            description:
                'Id of the group or Account, as in `bkper group list` and `bkper account list`.',
            example: '6235671829479424',
        }),
        name: z.string().openapi({
            description: 'The name as the Book writes it.',
            example: 'Credit Card',
        }),
        kind: z.enum(['group', 'account']).openapi({ description: 'A group or an Account.' }),
        root: z.string().openapi({
            description:
                'Id of its root (top-level) group: itself for a root group or an Account in no group; for an Account in several root groups, the first in Book order.',
            example: '5687803178385408',
        }),
    })
    .openapi('BookName', { description: 'A group or Account of the Book, by name.' });

export const BookNamesResponseSchema = z
    .object({
        names: z.array(BookNameSchema).openapi({
            description:
                'Every group and Account of the Book’s balances, each once, in Book order: root groups in order, each with its subgroups, then its Accounts, then the Accounts in no group. Archived Accounts with no balance are left out.',
        }),
    })
    .openapi('BookNamesResponse');

export const ReportRequestSchema = z
    .strictObject({
        prompt: ReportPromptSchema.optional().openapi({
            description:
                'The report the person asked for, in their own words and language: do not translate it. Include what they said about the period, the view, the chart (such as “as a donut” or “by month in a line”) and a `#hashtag` (only the first is read, as Bkper filters balances by one); leave out the Book’s name or id, which the path gives. Names of the Book’s groups and Accounts written exactly (case and accents aside) are reported as such, several side by side. Uses one Bkper AI decision; a suggestion of `GET /api/v1/books/{bookId}/suggestions`, sent as it is (spacing aside, case kept) with the same `language` (else `Accept-Language`, else English), uses none, and so does a Bkper query (a text with a `group:`, `account:` or `acc:` term, such as a query report’s own `text`), which is read as `query`.',
            example: 'show my expenses by category this year',
        }),
        query: ReportQuerySchema.optional().openapi({
            description:
                'Instead of `prompt`: a Bkper query, such as the one a Book shows its transactions with, read exactly as sent, with no AI: every amount the report shows is Bkper’s balance for that very query, as the Book’s sidebar shows it, future-dated transactions included; nothing is rewritten or cut off. Its `group:` and `account:` names (case and accents aside) are what the report is of, several side by side (up to six, the first found); names the Book does not have, or Bkper does not find, are left out, and with none the answer is 422 `query_not_a_report`. Its period is the days Bkper read, as written (`after:01/01/2026 before:01/01/2027` is Jan 1 – Dec 31, 2026; `before:` alone, a balance as of its last day; no dates, all time). Months for charts come from the same query by month (`by:m`), only when Bkper gives it the same totals; the comparison, from the same query with its dates moved to the period before, only when it has an end. The report’s `text` is the query itself.',
            example: "group:'Expenses' after:01/01/2026 before:01/04/2026",
        }),
        language: LanguageSchema.optional().openapi({
            description:
                'Language of the report’s texts, as a BCP 47 tag of one of the 133 Bkper languages, such as `pt` or `pt-BR`. Leave it out to write the report in the language of `prompt`, else `Accept-Language`, else English.',
        }),
        format: z.enum(['spec', 'html']).optional().openapi({
            description:
                'What to return. `html` to show the report to a person: one self-contained, interactive HTML file (`text/html`) that loads nothing and links to the report in the Report app; save it and publish or share it as it is, without asking for `spec` first or re-checking its amounts. `spec` (the default) for JSON, which Report’s own web client renders: the report as a json-render spec with its text, language, query, data time, chart and link.',
            example: 'html',
        }),
    })
    .refine(body => (body.prompt === undefined) !== (body.query === undefined), {
        message: 'Expected exactly one of prompt or query',
        path: ['prompt'],
    })
    .openapi('ReportRequest', {
        description:
            'Exactly one of `prompt` (the person’s request, in any language, or a suggestion’s or a report’s own `text`) or `query` (a Bkper query). Usually `{ "prompt": "…", "format": "html" }`.',
    });

export type ReportRequestBody = z.infer<typeof ReportRequestSchema>;

const SavedPromptIdSchema = z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/)
    .openapi({
        description: 'Opaque saved-prompt id returned by this API. Scoped to the Book.',
    });

export const SavedPromptParamsSchema = BookParamsSchema.extend({
    promptId: SavedPromptIdSchema.openapi({ param: { name: 'promptId', in: 'path' } }),
}).strict();

export const SavePromptRequestSchema = z
    .strictObject({
        prompt: ReportPromptSchema.openapi({
            description:
                'The original request, in its own words and language. Trimmed at the edges, 1–1000 characters; internal whitespace and case are preserved. No report is computed and no AI is called.',
            example: 'Despesas por mês este ano',
        }),
    })
    .openapi('SavePromptRequest');

export const MoveSavedPromptRequestSchema = z
    .strictObject({
        before: SavedPromptIdSchema.nullable().openapi({
            description:
                'The id of the saved prompt this one goes just before, or `null` for the end. Take it from the latest list; an id no longer on the shelf answers 409 `shelf_changed`.',
        }),
    })
    .openapi('MoveSavedPromptRequest');

export const SavedPromptSchema = z
    .strictObject({
        id: SavedPromptIdSchema,
        prompt: z.string().min(1).max(1000).openapi({
            description:
                'Only the saved request text. To build it against current Book data, send this as `prompt` to the singular POST /api/v1/books/{bookId}/report.',
        }),
    })
    .openapi('SavedPrompt', {
        description:
            'Book-shared original prompt, not a report snapshot or executable saved query. No HTML, intent, resolved period, amounts, inferred language or separately selected chart is saved.',
    });

export const SavedPromptsResponseSchema = z
    .strictObject({
        prompts: z.array(SavedPromptSchema).openapi({
            description:
                'All saved prompts in the shelf’s order: a new prompt goes last, and moves change it. The server follows every storage page. Visibility after saves, removals and moves is eventually consistent.',
        }),
        capabilities: z
            .strictObject({
                list: z.boolean().openapi({
                    description:
                        'True for OWNER, EDITOR, POSTER, RECORDER and VIEWER. Unknown or NONE roles are denied.',
                }),
                save: z.boolean().openapi({ description: 'True only for OWNER and EDITOR.' }),
                remove: z.boolean().openapi({
                    description:
                        'True only for OWNER and EDITOR; either may remove any prompt on this Book’s shelf.',
                }),
                move: z.boolean().openapi({
                    description:
                        'True only for OWNER and EDITOR; either may reorder any prompt on this Book’s shelf.',
                }),
            })
            .openapi({
                description:
                    'Freshly authorized capabilities, not a substitute for authorization on the next request. Native saved-query role rules apply; its owner-plan billing restriction is not inherited by app metadata.',
            }),
    })
    .openapi('SavedPromptsResponse');

export const ReportResponseSchema = z
    .object({
        spec: ReportSpecSchema.meta({
            id: 'ReportSpec',
            description:
                'The report as a flat json-render spec (`root` and `elements`) of the Report catalog, every text in `language`: `Report` (title, period, the `request` it answers as a person would type it, its period as asked, and a `notice` when it could not compare as asked, or draw the chart the prompt names, with why) holds `Answer` (amount, previous period amount and change; one per group or Account shown side by side, in order, with none for them together), `Chart` (when one fits), `Visualizations` (every chart that fits, at most six, each but the main one with its data), `BreakdownTable` (the subgroups and Accounts Bkper returns, with amount, share and change, nested; for a net result Report calculates, its roots and a total; side by side, the groups and Accounts shown, with no total) and `Source` (with `calculated` when Report calculated the net result). Every amount is a Bkper balance of one group or Account, as Bkper returns it, but a net result Report calculates. Amounts and ratios are exact decimal strings; months and instants are ISO.',
        }),
        language: z.string().openapi({
            description: 'The Bkper language of the report’s texts.',
            example: 'pt',
        }),
        query: z.string().openapi({
            description:
                'The Bkper query of exactly the report’s transactions and dates, the one its balances were read with, to list them or check balances in Bkper; of a `query`, that query as sent. Relative periods keep Bkper’s date variables (`$y`, `$m`, `$d`), which Bkper resolves from the Book’s today.',
            example: "group:'Expenses' after:$y before:$m+1 by:m",
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
                        'The chart in the spec: `bar`, `line`, `area` or `stacked` by month; `ranked-bar` or `donut` of the parts; `compare` (each part against the period compared with); `none` for no chart.',
                    example: 'donut',
                }),
                fallback: z.boolean().openapi({
                    description:
                        'True when the `prompt` names a chart that does not fit this report (such as a donut of a part below zero, or a bridge, which reports never draw), so `kind` is the closest chart that fits, or the one the report picks; the spec’s `Report` `notice` says why, in one line. False when the prompt names no chart, or one that fits.',
                    example: false,
                }),
            })
            .openapi({
                description:
                    'The chart the report shows first, and whether it stands in for the chart its `prompt` names. Every chart that fits is in the spec’s `Visualizations`.',
            }),
        text: z.string().openapi({
            description:
                'The report’s own short text, in `language`, as a person would type it: what it is of, how it is shown when by month, its period as asked (relative periods stay relative, such as `this year`) and what it is compared with, and its hashtag; of a `query`, the query itself. Send it as `prompt` to ask for the same report again, or show it to the person to edit.',
            example: 'Expenses by month this year',
        }),
        url: z.string().openapi({
            description:
                'The same report in the Report app, to open or share with the person: it asks again with the words sent (the `prompt`, or the `query`).',
            example: 'https://report.bkper.app/?book=abc123&q=expenses+by+month+this+year',
        }),
    })
    .openapi('ReportResponse', { description: 'The report, with `format: spec`.' });

export const ReportFileSchema = z.string().openapi({
    description:
        'With `format: html`: a self-contained, interactive HTML document of the report, in `language`. Every script and style is inline and it loads nothing, so it works in a sandboxed frame: the chart shows tooltips, previews of every other chart that fits show it in place, rows open in place, and a link opens the report, as the chart chosen, in the Report app (shown by the Bkper Agent in a Book, in place of the Agent).',
    example: '<!doctype html>\n<html lang="en" dir="ltr">…',
});

export const ReportErrorResponseSchema = ErrorResponseSchema.extend({
    suggestions: z.array(SuggestionSchema).optional().openapi({
        description:
            'With `not_a_report`: reports this Book can have, to offer the person instead; send one as `prompt`, with the same `language`, to build it with no AI.',
    }),
    problem: BookProblemSchema.optional(),
}).openapi('ReportErrorResponse', {
    description:
        'An error of a report request; with `not_a_report`, `suggestions`; with `empty_book`, `nothing_to_report`, `no_net_result` and `mixed_group`, `problem`: what is involved, and whether the person may organize the Book’s groups.',
});

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
