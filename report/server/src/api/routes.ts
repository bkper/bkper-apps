import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { supportedLanguage } from 'report-shared/languages';
import { t } from 'report-shared/strings';
import { HTTPException } from 'hono/http-exception';
import type { AppContext, AppEnv } from '../app-context.js';
import { buildReportFile, reportFileOpen } from '../services/report-file.js';
import { createReport, DEFAULT_LANGUAGE, type ReportRequest } from '../services/report-service.js';
import { loadBalances } from '../services/balances-loader.js';
import type { QueryBalances } from '../services/balances.js';
import type { Snapshot } from '../services/snapshot.js';
import { currentUserId, loadSnapshot } from '../services/snapshot-loader.js';
import { readOpening } from '../services/suggestions.js';
import { bookNames } from '../services/prompt-names.js';
import {
    listSavedPrompts,
    moveSavedPrompt,
    removeSavedPrompt,
    savePrompt,
} from '../services/saved-prompts.js';
import { requireViewPermission } from './authorization.js';
import { buildApiError } from './errors.js';
import { openApiDocumentConfig } from './openapi.js';
import { acceptedLanguage, reportAppUrl } from './request-context.js';
import {
    apiErrorResponses,
    BookNamesResponseSchema,
    BookParamsSchema,
    bookErrorResponses,
    ErrorResponseSchema,
    jsonResponse,
    PingResponseSchema,
    ReportErrorResponseSchema,
    ReportFileSchema,
    EXACTLY_ONE_REQUEST,
    ReportRequestSchema,
    type ReportRequestBody,
    ReportResponseSchema,
    SuggestionsQuerySchema,
    SuggestionsResponseSchema,
    MoveSavedPromptRequestSchema,
    SavedPromptParamsSchema,
    SavedPromptsResponseSchema,
    SavePromptRequestSchema,
    SavePromptResponseSchema,
} from './schemas.js';

type App = OpenAPIHono<AppEnv>;

const pingRoute = createRoute({
    method: 'get',
    path: '/api/v1/ping',
    tags: ['API'],
    summary: 'Ping app API',
    description: 'Checks that the API is reachable. Not needed before other calls.',
    responses: {
        200: jsonResponse('API is reachable', PingResponseSchema),
        ...apiErrorResponses,
    },
});

const suggestionsRoute = createRoute({
    method: 'get',
    path: '/api/v1/books/{bookId}/suggestions',
    tags: ['Reports'],
    summary: 'Suggest reports of a Book',
    description:
        'Up to three reports this Book can have, the main one first, each as a request a person would type and its `intent`: the Book’s groups at its first two levels, each as its natural report (income and expenses together this year, income or expenses by month, balances today), ranked by Bkper AI once each time the groups change. Periods: activity this year, or the last year with movements when this year has none (the text names that year), and balances today. Use them when the person does not know what to ask, or after `not_a_report`; to build one, send its `intent` (no AI) and, to show it, `format: html` to `POST /api/v1/books/{bookId}/report`. When the Book has no reports at all, there are none and `problem` tells why: `empty_book` (no transactions yet) or `nothing_to_report` (no groups, or most Accounts with transactions in no group); if the person may (`problem.canOrganize`), offer to help organize its groups, changing groups only, never transactions. Read-only.',
    request: { params: BookParamsSchema, query: SuggestionsQuerySchema },
    responses: {
        200: jsonResponse('Suggested reports', SuggestionsResponseSchema),
        ...bookErrorResponses,
    },
});

const namesRoute = createRoute({
    method: 'get',
    path: '/api/v1/books/{bookId}/names',
    tags: ['Reports'],
    summary: 'List the names of a Book’s groups and Accounts',
    description:
        'The names a report request can write to report a group or Account: written in a `prompt` to `POST /api/v1/books/{bookId}/report`, ignoring case and accents, each is what the report is of. For completing requests as they are typed; not needed to build a report. Read from the Book’s map, which may be up to 60 seconds old. Read-only.',
    request: { params: BookParamsSchema },
    responses: {
        200: jsonResponse('The Book’s group and Account names', BookNamesResponseSchema),
        ...bookErrorResponses,
    },
});

const reportRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/report',
    tags: ['Reports'],
    summary: 'Build a financial report of a Book from a request in any language',
    description: [
        'Builds a financial report of the Book: of one of its root groups (such as Expenses or Assets, with its subgroups and Accounts), of a group or Account the prompt names, of several side by side, or of income versus expenses, over a period of whole months, by month or not, optionally only for `#hashtags`. Read-only: the Book is never changed.',
        '',
        'To show a person a report, send `{ "prompt": "<their request, in their own words and language>", "format": "html" }` and give them the returned HTML file as it is: it is self-contained and interactive. With the Bkper CLI: `bkper app api request report /api/v1/books/<bookId>/report -d \'{"prompt":"…","format":"html"}\' > report.html`, then publish `report.html`. That one call is the whole task: do not ask for `spec` first, query the balances yourself or re-check the amounts; every amount is a Bkper balance read by code, and the file shows the query it read.',
        '',
        'With `format: spec` (the default) the report is the JSON Report’s own web client renders: its spec (with the data of every chart that fits), intent, language, query, data time, chart, trace (how its charts were chosen) and link. An `intent`, such as a suggestion’s or a previous report’s, builds the report without AI.',
        '',
        'Every amount is a Bkper balance of one group or Account, as Bkper returns it (but a net result Report calculates, labelled so), read by deterministic code; balances may be up to 60 seconds old. Code finds in the prompt the exact names of the Book’s groups and Accounts it writes, and its `#hashtags`; AI only recognizes the root group when the prompt writes no such name, the parts of the period it says (how long, which year, month and quarter, and those of a period it compares with; never a date), whether it asks about months, parts, an earlier period or a bridge, and which chart it names; code decides the report and its charts from those judgments and the numbers.',
    ].join('\n'),
    request: {
        params: BookParamsSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: ReportRequestSchema } },
        },
    },
    responses: {
        200: {
            description:
                'The report: one self-contained HTML file (`format: html`), or JSON with its spec, intent, language, query, chart, trace and link (`format: spec`)',
            content: {
                'application/json': { schema: ReportResponseSchema },
                'text/html': { schema: ReportFileSchema },
            },
        },
        422: jsonResponse(
            'Not a report this Book can have (`not_a_report`, with `suggestions` to offer instead), a period that has not started (`future_period`), an intent whose root is not a root group of the Book (`unknown_root`) or whose target is not under its root (`unknown_target`), targets side by side that mix balances with activity (`mixed_targets`), a net result the Book does not have (`no_net_result`: no group combines its Incoming and Outgoing groups, or they share Accounts), a group that mixes balances with activity (`mixed_group`), or a Book with no reports at all (`empty_book`: no transactions yet; `nothing_to_report`: no groups to report on). The last four carry `problem`: what is involved and whether the person may organize the Book’s groups (`canOrganize`), which fixes all but `empty_book`; offer it, changing groups only, never transactions',
            ReportErrorResponseSchema
        ),
        429: jsonResponse(
            'The person’s Bkper AI allowance is used up (`ai_allowance_exhausted`); requests by `intent` still work',
            ErrorResponseSchema
        ),
        ...bookErrorResponses,
    },
});

const savedPromptErrors = {
    ...bookErrorResponses,
    403: jsonResponse(
        'Insufficient Book role (`forbidden`): list requires OWNER, EDITOR, POSTER, RECORDER or VIEWER; save, remove and move require OWNER or EDITOR.',
        ErrorResponseSchema
    ),
    502: jsonResponse(
        'Bkper authorization failed (`upstream_error`) or saved-prompt storage failed (`storage_error`). Retry safely; a failed write may have reached storage.',
        ErrorResponseSchema
    ),
};

const listSavedPromptsRoute = createRoute({
    method: 'get',
    path: '/api/v1/books/{bookId}/reports',
    tags: ['Saved prompts'],
    summary: 'List the Book’s shared saved prompts and current capabilities',
    description:
        'Lists original requests shared by every collaborator of this Book, including RECORDER. The plural /reports is the saved-prompt shelf; the singular /report builds a report. Authorization reads the Book afresh, never the balances cache. Every storage page is read; visibility is eventually consistent. This never computes a report or changes the Book. Responses must not be cached.',
    request: { params: BookParamsSchema },
    responses: {
        200: jsonResponse(
            'Saved prompts and freshly authorized capabilities',
            SavedPromptsResponseSchema
        ),
        ...savedPromptErrors,
    },
});

const savePromptRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/reports',
    tags: ['Saved prompts'],
    summary: 'Save an original prompt on the Book’s shared shelf',
    description:
        'Requires OWNER or EDITOR, checked afresh. Saves only the trimmed original prompt and its opaque id in durable app metadata, not in the Book’s executable saved-query list. Identical text after edge trimming is idempotent across collaborators. Does not store HTML, resolved intent, dates, numbers, inferred language or a separately selected chart. No AI or report computation runs. Native saved-query role permissions apply, but its owner-plan billing restriction is not inherited. Independent items never overwrite each other; visibility and concurrent changes to the same item follow KV eventual consistency. A later save can save a removed prompt again.',
    request: {
        params: BookParamsSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: SavePromptRequestSchema } },
        },
    },
    responses: {
        200: jsonResponse('Saved prompt, also for an identical retry', SavePromptResponseSchema),
        ...savedPromptErrors,
    },
});

const removeSavedPromptRoute = createRoute({
    method: 'delete',
    path: '/api/v1/books/{bookId}/reports/{reportId}',
    tags: ['Saved prompts'],
    summary: 'Remove a prompt from the Book’s shared shelf',
    description:
        'Requires OWNER or EDITOR, checked afresh. Either may remove any saved prompt on this Book. Idempotent: an absent id also succeeds. Removes only this item of app metadata, never a report, a Book saved query or financial data. Visibility is eventually consistent. A failed write may have reached storage, so retrying the same removal is safe.',
    request: { params: SavedPromptParamsSchema },
    responses: {
        204: { description: 'Removed, or already absent. No response body.' },
        ...savedPromptErrors,
    },
});

const moveSavedPromptRoute = createRoute({
    method: 'put',
    path: '/api/v1/books/{bookId}/reports/{reportId}/position',
    tags: ['Saved prompts'],
    summary: 'Move a prompt on the Book’s shared shelf',
    description:
        'Requires OWNER or EDITOR, checked afresh. Puts the saved prompt just before `before`, or at the end for `null`, and answers the whole shelf in its new order, as the list does. Already in place, nothing is written. Only this prompt’s place changes; prompts saved before the shelf had an order get one on the first move, in the order they had. Never changes a prompt’s text, a report or the Book. Visibility is eventually consistent, so a list right after may not show the move yet; the response is the order this request wrote. Retrying the same move is safe.',
    request: {
        params: SavedPromptParamsSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: MoveSavedPromptRequestSchema } },
        },
    },
    responses: {
        200: jsonResponse('The shelf in its new order', SavedPromptsResponseSchema),
        ...savedPromptErrors,
        404: jsonResponse(
            'The saved prompt is not on the shelf (`report_not_found`), or the Book was not found (`book_not_found`).',
            ErrorResponseSchema
        ),
        409: jsonResponse(
            '`before` is no longer on the shelf (`shelf_changed`): list the shelf again and retry.',
            ErrorResponseSchema
        ),
    },
});

export function registerApiRoutes(app: App): void {
    app.openapi(pingRoute, c => c.json({ ok: true, source: 'report' }, 200));

    app.openapi(suggestionsRoute, async c => {
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        const { language } = c.req.valid('query');
        const { snapshot, userId } = await readableSnapshot(context, bookId);
        const lang =
            (language && supportedLanguage(language)) ??
            acceptedLanguage(c.req.header('Accept-Language')) ??
            DEFAULT_LANGUAGE;
        const opening = await readOpening(snapshot, lang, {
            loadBalances: bookBalances(context, bookId, snapshot, userId),
            timing: context.timing,
            decisions: context.decisions,
            cache: context.env.KV,
        });
        return c.json(opening, 200);
    });

    app.openapi(namesRoute, async c => {
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        const { snapshot } = await readableSnapshot(context, bookId);
        const names = await context.timing.measure('compute', async () => bookNames(snapshot));
        return c.json({ names }, 200);
    });

    app.openapi(reportRoute, async c => {
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        const body = c.req.valid('json');
        const { snapshot, userId } = await readableSnapshot(context, bookId);
        const result = await createReport(
            snapshot,
            reportRequest(body),
            {
                requested: body.language && supportedLanguage(body.language),
                accepted: acceptedLanguage(c.req.header('Accept-Language')),
            },
            {
                decisions: context.decisions,
                loadBalances: bookBalances(context, bookId, snapshot, userId),
                timing: context.timing,
                cache: context.env.KV,
            }
        );
        const { text, ...report } = result;
        const url = reportAppUrl(c.req.url, bookId, text);
        if (body.format === 'html') {
            const open = reportFileOpen(bookId, { ...report, charts: report.trace.chart });
            const file = await context.timing.measure('render', async () =>
                buildReportFile(report.spec, {
                    link: { url, label: t('source_open_in_report', report.language) },
                    ...(open ? { open } : {}),
                })
            );
            return c.html(file, 200);
        }
        return c.json({ ...report, url }, 200);
    });

    app.openapi(listSavedPromptsRoute, async c => {
        c.header('Cache-Control', 'no-store');
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        return c.json(
            await listSavedPrompts(bookId, { bkper: context.bkper, kv: context.env.KV }),
            200
        );
    });

    app.openapi(savePromptRoute, async c => {
        c.header('Cache-Control', 'no-store');
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        const { prompt } = c.req.valid('json');
        return c.json(
            await savePrompt(bookId, prompt, { bkper: context.bkper, kv: context.env.KV }),
            200
        );
    });

    app.openapi(removeSavedPromptRoute, async c => {
        c.header('Cache-Control', 'no-store');
        const context = c.var.appContext;
        const { bookId, reportId } = c.req.valid('param');
        await removeSavedPrompt(bookId, reportId, { bkper: context.bkper, kv: context.env.KV });
        return c.body(null, 204);
    });

    app.openapi(moveSavedPromptRoute, async c => {
        c.header('Cache-Control', 'no-store');
        const context = c.var.appContext;
        const { bookId, reportId } = c.req.valid('param');
        const { before } = c.req.valid('json');
        return c.json(
            await moveSavedPrompt(bookId, reportId, before, {
                bkper: context.bkper,
                kv: context.env.KV,
            }),
            200
        );
    });

    app.doc('/openapi.json', openApiDocumentConfig);

    app.all('/api/*', c =>
        c.json(buildApiError('not_found', `Route not found: ${c.req.method} ${c.req.path}`), 404)
    );
}

/** The request of a validated body, which has exactly one of `prompt` and `intent`. */
function reportRequest({ prompt, intent }: ReportRequestBody): ReportRequest {
    if (intent) {
        return { intent };
    }
    if (prompt !== undefined) {
        return { prompt };
    }
    throw new HTTPException(400, { message: EXACTLY_ONE_REQUEST });
}

/** The Book snapshot, for a user who may read the Book's balances, and that user. */
/** Reads balances queries of the snapshot's Book for the user, through the minute's cache. */
function bookBalances(
    context: AppContext,
    bookId: string,
    snapshot: Snapshot,
    userId: string
): (queries: string[]) => Promise<QueryBalances[]> {
    return queries =>
        loadBalances(queries, {
            userId,
            bookId,
            today: snapshot.today,
            kv: context.env.KV,
            timing: context.timing,
            read: query => context.readBalances(snapshot.book, query),
            defer: context.defer,
        });
}

async function readableSnapshot(
    context: AppContext,
    bookId: string
): Promise<{ snapshot: Snapshot; userId: string }> {
    const userId = await currentUserId(context.bkper, context.timing);
    const snapshot = await loadSnapshot(bookId, {
        userId,
        bkper: context.bkper,
        kv: context.env.KV,
        timing: context.timing,
        defer: context.defer,
    });
    requireViewPermission(snapshot.book.permission);
    return { snapshot, userId };
}
