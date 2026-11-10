import { z } from '@hono/zod-openapi';
import { ReportSpecSchema, VIEW_KINDS } from 'report-shared/catalog';
import { supportedLanguage } from 'report-shared/languages';
import { MAX_ALONGSIDE } from 'report-shared/report-intent';
import type { ZodType } from 'zod';
import { COMPARISON_ERRORS } from '../services/period-query.js';
import { CHART_KINDS, CHART_RULES, UNFIT_REASON_CODES } from '../services/report.js';
import { SHOW_RULE_NAMES } from '../services/intent-resolver.js';
import { PERIOD_RULES } from '../services/period-questions.js';
import {
    ComparedPartsSchema,
    PeriodIdSchema,
    PeriodPartsSchema,
    ReportIntentSchema,
    ReportSubjectSchema,
} from '../services/report-intent.js';
import { ReportPromptSchema } from '../services/report-prompt.js';

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
                        '`future_period` (422, the period has not started),',
                        '`unknown_root` (422, the intent names no root group of the Book),',
                        '`unknown_target` (422, the intent’s `target`, or one `alongside`, is no group or Account under its root group),',
                        '`mixed_targets` (422, the intent’s `alongside` mixes balances at a date, Asset and Liability, with activity in a period, Incoming and Outgoing: ask for them in separate reports),',
                        '`no_net_result` (422, the Book has no net result: no group combines its Incoming and Outgoing groups, or its activity groups share Accounts; organizing its groups fixes it),',
                        '`empty_book` (422, the Book has no transactions yet),',
                        '`nothing_to_report` (422, the Book has no groups, or most of its Accounts with transactions are in no group; organizing them into groups fixes it),',
                        '`mixed_group` (422, the group asked for holds both balances, Asset or Liability, and activity, Incoming or Outgoing; separating them into groups of their own fixes it),',
                        '`ai_allowance_exhausted` (429, the person’s Bkper AI allowance is used up: suggestions sent as they are, and requests by `intent`, still work),',
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
const PeriodPartsMeta = PeriodPartsSchema.meta({
    id: 'PeriodParts',
    description:
        'A period as its parts; at least one. Without `span`, a month when `month` is given, else a quarter when `quarter` is, else a year. Examples: last year `{ "span": "year", "year": "previous" }`; this year to date `{ "span": "year_to_date" }`; Q3 2024 `{ "span": "quarter", "year": 2024, "quarter": 3 }`; March `{ "span": "month", "month": 3 }`; January last year `{ "span": "month", "month": 1, "year": "previous" }`; a balance now `{ "span": "now" }`.',
});
const PeriodIdMeta = PeriodIdSchema.meta({
    description: 'A period id of older intents, still accepted.',
    example: 'last_year',
});
const SubjectSchema = ReportSubjectSchema.extend({
    root: ReportSubjectSchema.shape.root.meta({
        description:
            'Id of a root (top-level) group of the Book, or of an Account in no group, as in `bkper group list` and `bkper account list`.',
        example: '5687803178385408',
    }),
    target: ReportSubjectSchema.shape.target.meta({
        description:
            'Id of a group or Account under the root group, at any depth, to show instead of the whole root. Left out, the root.',
        example: '6235671829479424',
    }),
}).meta({
    id: 'ReportSubject',
    description: 'A group or Account to show side by side: a root, or a `target` under it.',
});
const IntentSchema = ReportIntentSchema.extend({
    root: shape.root.meta({
        description:
            'Id of a root (top-level) group of the Book, as in `bkper group list`, or `net-result` for income versus expenses: the net result Bkper calculates for the root group that combines Incoming and Outgoing groups; without one, the Incoming roots minus the Outgoing roots, labelled as calculated by Report, when each root is purely Incoming or Outgoing and no two share an Account. Also the id of an Account in no group (`bkper account list`), reported alone.',
        example: 'net-result',
    }),
    target: shape.target.meta({
        description:
            'Id of a group or Account under the root group, at any depth (`bkper group list`, `bkper account list`), to report instead of the whole root: its own Bkper balance and its own subgroups and Accounts, read from the root’s balances. Left out, the root. Not with `net-result` or an Account in no group.',
        example: '5687803178385408',
    }),
    alongside: z.array(SubjectSchema).min(1).max(MAX_ALONGSIDE).optional().meta({
        description:
            'More groups or Accounts to show side by side with the first (`root` and `target`), in order: each with its own Bkper balance, never added up, with no total and no shares of one. All balances at a date (Asset, Liability) or all activity in a period (Incoming, Outgoing), else `mixed_targets`. One asked for twice shows once. Only charts that imply no whole fit: by month, area, ranked bars, compared and the table; a pie, donut or stacked chart shows dimmed with why. To show their total, the person adds a group that holds them in Bkper. Not with `net-result`.',
    }),
    period: z.union([PeriodPartsMeta, PeriodIdMeta]).meta({
        description:
            'The period, in the Book’s time zone, as its parts, as the person said them: relative words stay relative (`{ "span": "year", "year": "previous" }` is last year whenever it is read) and written years stay written (`{ "span": "quarter", "year": 2024, "quarter": 3 }` is Q3 2024). Periods are whole months: a running one (this month, quarter or year, year to date, the last 12 months) runs through the end of this month, and its comparison covers the same months; past ones are whole calendar periods. Responses always give parts; the period ids of older intents (`today`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_year`, `ytd`, `last_12_months`, `all`, a year `2025`, a quarter `2025-Q3` or a month `2025-10`) are still accepted.',
        example: { span: 'year', year: 'previous' },
    }),
    compared: ComparedPartsSchema.optional().meta({
        id: 'ComparedParts',
        description:
            'The period to compare with, as its parts; those left out are the period’s own, and a month or quarter without a year is the latest one before the period. It must be the same kind of period: `{ "year": 2023 }` compares last year with 2023, `{ "quarter": 1 }` compares Q3 with Q1, `{ "year": 2019 }` compares January with January 2019. Named later than the period, the two swap, so change reads from the earlier to the later. A comparison of another kind, one that overlaps the period, or one with all time cannot be made: the report then compares with the previous period instead (all time with nothing) and says so (`trace.comparisonError`, and a notice in the spec). Left out, `compareWith` says what the period is compared with.',
        example: { year: 2023 },
    }),
    monthly: shape.monthly.meta({ description: 'Show the period month by month.' }),
    compareWith: shape.compareWith.meta({
        description:
            'Without `compared`, what the period is compared with: `previous`, the period right before it (December for January, the previous quarter or year; for a running period the same months of the previous one), or `year_earlier`, the same months a year earlier. A balance at a date (Asset, Liability) compares with the balance at the end of the previous period, or a year before its date. All time compares with nothing. Left out, `previous`.',
        example: 'year_earlier',
    }),
    view: shape.view.meta({
        description:
            'The layout asked for: `trend` (over time), `breakdown` (what makes up the amount: a donut of a few parts, a pie of more, else ranked bars) or `total` (the amount alone). Left out, the report picks one.',
    }),
    chart: shape.chart.meta({
        description:
            'The chart the person asked for: `bar` or `line` (by month), `area` (by month), `stacked` (the parts by month), `ranked-bar`, `donut` or `pie` (the parts of the total), `compare` (each part against the period compared with, see `compareWith`), `table` (no chart) or `auto`. `waterfall` (a bridge) is accepted but never drawn, as its bars would not be Bkper balances: the report shows it dimmed with why. Left out or `auto`, the report picks one; a chart that does not fit the report is not drawn: the report shows the closest chart that fits, else the one it picks, and offers the asked-for chart dimmed with why (see the response’s `chart` and `trace.chart`).',
        example: 'pie',
    }),
    hashtags: shape.hashtags.meta({
        description:
            'Only transactions with this hashtag, without `#`: at most one, as Bkper filters balances by one.',
        example: ['travel'],
    }),
}).meta({
    id: 'ReportIntent',
    description:
        'Exactly what to report, with no AI needed: a root group (or a `target` under it), an Account in no group or `net-result`, others `alongside` it, a period, whether by month, what it is compared with, an optional view, chart and hashtags. Take it from an earlier report’s `intent`.',
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

/** Why a report request is invalid when it has neither or both of `prompt` and `intent`. */
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

export const EXACTLY_ONE_REQUEST = 'Send exactly one of `prompt` or `intent`.';

// One object rather than a union of the two requests, so that a validation error names the
// field that is wrong instead of the whole body.
export const ReportRequestSchema = z
    .strictObject({
        prompt: ReportPromptSchema.optional().openapi({
            description:
                'The report the person asked for, in their own words and language: do not translate it. Include what they said about the period, the view, the chart and a `#hashtag` (only the first is read, as Bkper filters balances by one); leave out the Book’s name or id, which the path gives. Names of the Book’s groups and Accounts written exactly (case and accents aside) are reported as such, several side by side. Uses one Bkper AI decision; a suggestion of `GET /api/v1/books/{bookId}/suggestions`, sent as it is (spacing aside, case kept) with the same `language` (else `Accept-Language`, else English), uses none.',
            example: 'show my expenses by category this year',
        }),
        intent: IntentSchema.optional(),
        chart: shape.chart.meta({
            description:
                'The chart to show, over any the request names: how to show the report, not what it is, so its `text` never names it. `bar`, `line`, `area` or `stacked` by month; `ranked-bar`, `donut` or `pie` of the parts; `compare` (each part against the period compared with); `table` (no chart); `auto` (the report picks). A chart that does not fit the report is not drawn: the report shows the closest chart that fits, else the one it picks, and offers the asked-for chart dimmed with why (`waterfall` never fits). To reopen a report as the person last saw it, send its `text` with its `language` and the chart they chose.',
            example: 'pie',
        }),
        language: LanguageSchema.optional().openapi({
            description:
                'Language of the report’s texts, as a BCP 47 tag of one of the 133 Bkper languages, such as `pt` or `pt-BR`. Leave it out to write the report in the language of `prompt`, else `Accept-Language`, else English.',
        }),
        format: z.enum(['spec', 'html']).optional().openapi({
            description:
                'What to return. `html` to show the report to a person: one self-contained, interactive HTML file (`text/html`) that loads nothing and links to the report in the Report app; save it and publish or share it as it is, without asking for `spec` first or re-checking its amounts. `spec` (the default) for JSON, which Report’s own web client renders: the report as a json-render spec with its intent, text, language, query, data time, chart, trace and link.',
            example: 'html',
        }),
    })
    .refine(body => (body.prompt === undefined) !== (body.intent === undefined), {
        message: EXACTLY_ONE_REQUEST,
    })
    .openapi('ReportRequest', {
        description:
            'Exactly one of `prompt` (the person’s request, in any language) or `intent` (from an earlier report, with no AI); a suggestion is sent as `prompt`. Usually `{ "prompt": "…", "format": "html" }`.',
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

const ViewKindSchema = z.enum(VIEW_KINDS).openapi({
    description:
        'A way to show the report: `bar`, `line`, `area` or `stacked` by month; `ranked-bar`, `donut` or `pie` of the parts; `compare` (each part against the previous period); `waterfall` (a bridge, never drawn: only offered dimmed when asked for); `table` (no chart).',
    example: 'donut',
});

const ChoiceJudgmentSchema = z.object({
    answer: z.string().openapi({ description: 'The option chosen.' }),
    score: z.number().min(0).max(1).openapi({ description: 'How sure the model is of it.' }),
});

const YesNoJudgmentSchema = z.object({
    answer: z.boolean().openapi({ description: 'Yes, from the threshold of the question on.' }),
    score: z.number().min(0).max(1).openapi({ description: 'The probability of yes.' }),
});

const PeriodPartJudgmentSchema = ChoiceJudgmentSchema.extend({
    read: z.union([z.string(), z.number()]).optional().openapi({
        description:
            'The value read, after its threshold and `periodRules`, as the intent’s period parts write it (`next`: the next year, month or quarter, a period that has not started); left out, the part is unspecified.',
    }),
});

export const ReportTraceSchema = z
    .object({
        judgments: z
            .object({
                root: ChoiceJudgmentSchema.openapi({
                    description: 'The group asked about, by name, `net-result` or `none`.',
                }),
                period: PeriodPartJudgmentSchema.openapi({
                    description:
                        'How long the period asked about is: `month`, `quarter`, `year`, `year_to_date`, `last_12_months`, `all_time`, `now` or `unspecified`. With the parts below, code builds the period; a request that names none reads the default period.',
                }),
                year: PeriodPartJudgmentSchema.optional().openapi({
                    description:
                        'The year said for the period: `this_year`, `last_year`, `year_before_last`, `next_year`, a year the request writes, or `unspecified`.',
                }),
                month: PeriodPartJudgmentSchema.optional().openapi({
                    description:
                        'The month said for the period: `January` to `December`, `this_month`, `last_month`, `next_month` or `unspecified`.',
                }),
                quarter: PeriodPartJudgmentSchema.optional().openapi({
                    description:
                        'The quarter said for the period: `Q1` to `Q4`, `this_quarter`, `last_quarter`, `next_quarter` or `unspecified`.',
                }),
                compared_year: PeriodPartJudgmentSchema.optional().openapi({
                    description: 'The year said for a second period the request compares with.',
                }),
                compared_month: PeriodPartJudgmentSchema.optional().openapi({
                    description: 'The month said for a second period the request compares with.',
                }),
                compared_quarter: PeriodPartJudgmentSchema.optional().openapi({
                    description: 'The quarter said for a second period the request compares with.',
                }),
                year_earlier: YesNoJudgmentSchema.optional().openapi({
                    description:
                        'Whether it compares with the same period a year earlier; read only when it names no second period.',
                }),
                over_time: YesNoJudgmentSchema.openapi({
                    description: 'Whether the request asks how the amounts change over time.',
                }),
                composition: YesNoJudgmentSchema.openapi({
                    description: 'Whether it asks what makes up the amount.',
                }),
                versus_earlier: YesNoJudgmentSchema.openapi({
                    description: 'Whether it compares with an earlier period.',
                }),
                bridge: YesNoJudgmentSchema.openapi({
                    description: 'Whether it asks how one amount leads to another, step by step.',
                }),
                chart_named: ChoiceJudgmentSchema.openapi({
                    description:
                        'The chart word it uses: `pie`, `bars`, `line`, `area`, `stacked`, `waterfall`, `table` (just the numbers) or `none`.',
                }),
                language: ChoiceJudgmentSchema.openapi({
                    description: 'The language it is written in.',
                }),
            })
            .optional()
            .openapi({
                description:
                    'With a `prompt`: what Bkper AI recognized in it, each answer with its score. Code decides the report from these.',
            }),
        names: z
            .array(z.string())
            .optional()
            .openapi({
                description:
                    'With a `prompt` that writes names of the Book’s groups or Accounts: those names, as the Book writes them, in order. The report is of them (side by side when several), not of the `root` judgment.',
                example: ['Food', 'Rent'],
            }),
        periodRules: z
            .array(z.enum(PERIOD_RULES))
            .optional()
            .openapi({
                description:
                    'With a `prompt`: the rules that changed the parts of the period read, in order: `span_alone` (a month, quarter or year with nothing saying which is no period), `rolling_period` (the last 12 months ignore a relative year), `kind_of_period` (a second period said as a month and a quarter is of the period’s kind), `same_as_period` (compared parts equal to the period’s say no other period) or `previous_of_period` (the previous month or quarter of a second period is the default comparison; last year counts back from a written year).',
                example: ['same_as_period'],
            }),
        rule: z.enum(SHOW_RULE_NAMES).optional().openapi({
            description:
                'With a `prompt`: the first rule that applied to the judgments, in order: `named` (the chart word), `bridge` (a waterfall), `versus_earlier` (a comparison), `over_time_composition` (stacked parts), `over_time` (by month), `composition` (the parts) or `auto` (the report picks).',
            example: 'named',
        }),
        comparisonError: z.enum(COMPARISON_ERRORS).optional().openapi({
            description:
                'Present when the comparison the intent asks for cannot be made: `comparison_kind_mismatch` (another kind of period, such as a month for a year), `comparison_not_earlier` (it overlaps the period) or `comparison_unavailable` (all time has nothing before it). The report then compares with the previous period instead (all time with nothing), and the spec’s `Report` says so in its `notice`.',
            example: 'comparison_kind_mismatch',
        }),
        facts: z
            .object({
                rows: z.int().min(0).openapi({
                    description: 'Top-level parts with an amount in the period.',
                    example: 6,
                }),
                negative: z.int().min(0).openapi({
                    description: 'Of those, the parts below zero, in the sense of the report.',
                    example: 1,
                }),
                mixed: z.boolean().openapi({
                    description:
                        'Whether the parts are of different types, as under a mixed group or in a net result.',
                    example: false,
                }),
                months: z
                    .int()
                    .min(0)
                    .openapi({ description: 'Months of the period.', example: 12 }),
                previous: z.boolean().openapi({
                    description: 'Whether there is a previous period to compare with.',
                    example: true,
                }),
                net: z.boolean().openapi({
                    description: 'Whether the report is a net result (income versus expenses).',
                    example: false,
                }),
                permanent: z.boolean().openapi({
                    description:
                        'Whether the report is a balance at the end of the period (Assets, Liabilities) rather than activity within it.',
                    example: false,
                }),
                sideBySide: z.literal(true).optional().openapi({
                    description:
                        'Present when the report shows several groups or Accounts side by side (the parts are those), which are no parts of one whole.',
                }),
            })
            .openapi({
                description: 'The facts of the report’s numbers that decide which charts fit.',
            }),
        chart: z
            .object({
                fitting: z.array(ViewKindSchema).openapi({
                    description:
                        'Every chart that fits the report, in the order to offer them; the spec’s `Visualizations` carries the data of each.',
                }),
                main: ViewKindSchema.openapi({ description: 'The chart shown first.' }),
                rule: z.enum(CHART_RULES).openapi({
                    description:
                        'What chose `main`: `preference` (the intent’s `chart`, which fits), `closest` (the fitting chart closest to a preference that does not fit) or `rules` (the report’s own choice, with no preference or nothing close).',
                    example: 'closest',
                }),
                unfit: z
                    .object({
                        kind: ViewKindSchema.openapi({
                            description: 'The chart the intent prefers.',
                        }),
                        reason: z.object({
                            code: z.enum(UNFIT_REASON_CODES).openapi({
                                description:
                                    'Why it does not fit: `net_result`, `negative_part` (a part below zero, `rowId`), `mixed_parts`, `few_parts`, `too_many_parts`, `few_months`, `no_amounts`, `no_previous`, `not_a_whole` (the parts Bkper returns do not add up to the total), `no_bridge` (a bridge is never drawn) or `side_by_side` (groups or Accounts side by side are no parts of one whole). `not_a_bridge` and `no_change` are no longer given.',
                                example: 'negative_part',
                            }),
                            rowId: z.string().optional().openapi({
                                description: 'The breakdown row that is the reason.',
                            }),
                        }),
                    })
                    .optional()
                    .openapi({
                        description:
                            'The preferred chart, when it does not fit the report, and why; the spec shows it dimmed with the reason in words.',
                    }),
            })
            .openapi({ description: 'The charts that fit, and how the main one was chosen.' }),
    })
    .openapi('ReportTrace', {
        description:
            'How the report chose its charts: the judgments of the request and the rule they fired, then the facts of its numbers, from which code decides which charts fit.',
    });

export const ReportResponseSchema = z
    .object({
        spec: ReportSpecSchema.meta({
            id: 'ReportSpec',
            description:
                'The report as a flat json-render spec (`root` and `elements`) of the Report catalog, every text in `language`: `Report` (title, period, the `request` it answers as a person would type it, its period as asked, and a `notice` when it could not compare as asked) holds `Answer` (amount, previous period amount and change; one per group or Account shown side by side, in order, with none for them together), `Chart` (when one fits), `Visualizations` (every other chart that fits, with its data, and a preferred chart that does not fit with why), `BreakdownTable` (the subgroups and Accounts Bkper returns, with amount, share and change, nested; for a net result Report calculates, its roots and a total; side by side, the groups and Accounts shown, with no total) and `Source` (with `calculated` when Report calculated the net result). Every amount is a Bkper balance of one group or Account, as Bkper returns it, but a net result Report calculates. Amounts and ratios are exact decimal strings; months and instants are ISO.',
        }),
        intent: IntentSchema,
        language: z.string().openapi({
            description: 'The Bkper language of the report’s texts.',
            example: 'pt',
        }),
        query: z.string().openapi({
            description:
                'The Bkper query of exactly the report’s transactions and dates, the one its balances were read with, to list them or check balances in Bkper. Relative periods keep Bkper’s date variables (`$y`, `$m`, `$d`), which Bkper resolves from the Book’s today.',
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
                        'The chart in the spec: `bar`, `line`, `area` or `stacked` by month; `ranked-bar`, `donut` or `pie` of the parts; `compare` (each part against the previous period); `none` for no chart. `waterfall` is no longer given.',
                    example: 'pie',
                }),
                fallback: z.boolean().openapi({
                    description:
                        'True when the intent’s `chart` does not fit this report, so `kind` is the closest chart that fits, or the one the report picks (see `trace.chart`).',
                    example: false,
                }),
            })
            .openapi({ description: 'The chart drawn, and whether the one asked for fit.' }),
        text: z.string().openapi({
            description:
                'The report’s own short text, in `language`, as a person would type it: what it is of, how it is shown when by month, its period as asked (relative periods stay relative, such as `this year`) and what it is compared with, and its hashtag. Send it as `prompt` to ask for the same report again, or show it to the person to edit.',
            example: 'Expenses by month this year',
        }),
        trace: ReportTraceSchema,
        url: z.string().openapi({
            description: 'The same report in the Report app, to open or share with the person.',
            example: 'https://report.bkper.app/?book=abc123&q=expenses+by+month+this+year',
        }),
    })
    .openapi('ReportResponse', { description: 'The report, with `format: spec`.' });

export const ReportFileSchema = z.string().openapi({
    description:
        'With `format: html`: a self-contained, interactive HTML document of the report, in `language`. Every script and style is inline and it loads nothing, so it works in a sandboxed frame: the chart shows tooltips, previews of every other chart that fits show it in place, rows open in place, and a link opens the report, as the chart chosen, in the Report app (shown by the Bkper Agent in a Book, in place of the Agent). It carries no trace.',
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
