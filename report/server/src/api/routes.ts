import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { supportedLanguage } from 'report-shared/languages';
import { t } from 'report-shared/strings';
import { HTTPException } from 'hono/http-exception';
import type { AppContext, AppEnv } from '../app-context.js';
import { buildReportFile, reportFileOpen } from '../services/report-file.js';
import { createReport, DEFAULT_LANGUAGE, type ReportRequest } from '../services/report-service.js';
import type { Snapshot } from '../services/snapshot.js';
import { loadSnapshot } from '../services/snapshot-loader.js';
import { buildSuggestions } from '../services/suggestions.js';
import { requireViewPermission } from './authorization.js';
import { buildApiError } from './errors.js';
import { openApiDocumentConfig } from './openapi.js';
import { acceptedLanguage, reportAppUrl } from './request-context.js';
import {
    apiErrorResponses,
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
        'Up to three reports this Book can have, each as a request a person would type and its `intent`, chosen by fixed rules from the Book’s groups and data. Use them when the person does not know what to ask, or after `not_a_report`; to build one, send its `intent` (no AI) and, to show it, `format: html` to `POST /api/v1/books/{bookId}/report`. Read-only.',
    request: { params: BookParamsSchema, query: SuggestionsQuerySchema },
    responses: {
        200: jsonResponse('Suggested reports', SuggestionsResponseSchema),
        ...bookErrorResponses,
    },
});

const reportRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/report',
    tags: ['Reports'],
    summary: 'Build a financial report of a Book from a request in any language',
    description: [
        'Builds a financial report of the Book: of one of its root groups (such as Expenses or Assets, with its subgroups and Accounts) or of income versus expenses, over a period of whole months, by month or not, optionally only for `#hashtags`. Read-only: the Book is never changed.',
        '',
        'To show a person a report, send `{ "prompt": "<their request, in their own words and language>", "format": "html" }` and give them the returned HTML file as it is: it is self-contained and interactive. With the Bkper CLI: `bkper app api request report /api/v1/books/<bookId>/report -d \'{"prompt":"…","format":"html"}\' > report.html`, then publish `report.html`.',
        '',
        'With `format: spec` (the default) the report is JSON: its spec, intent, language, query, data time, chart and link. An `intent`, such as a suggestion’s or a previous report’s, builds the report without AI.',
        '',
        'Numbers are computed by deterministic code from the Book’s balances, which may be up to 60 seconds old; AI only reads the prompt to choose the group, period, view and chart among the options the Book has.',
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
                'The report: one self-contained HTML file (`format: html`), or JSON with its spec, intent, language, query and link (`format: spec`)',
            content: {
                'application/json': { schema: ReportResponseSchema },
                'text/html': { schema: ReportFileSchema },
            },
        },
        422: jsonResponse(
            'Not a report this Book can have (`not_a_report`, with `suggestions` to offer instead), a period that has not started (`future_period`), or an intent whose root is not a root group of the Book (`unknown_root`)',
            ReportErrorResponseSchema
        ),
        429: jsonResponse(
            'The person’s Bkper AI allowance is used up (`ai_allowance_exhausted`); requests by `intent` still work',
            ErrorResponseSchema
        ),
        ...bookErrorResponses,
    },
});

export function registerApiRoutes(app: App): void {
    app.openapi(pingRoute, c => c.json({ ok: true, source: 'report' }, 200));

    app.openapi(suggestionsRoute, async c => {
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        const { language } = c.req.valid('query');
        const snapshot = await readableSnapshot(context, bookId);
        const lang =
            (language && supportedLanguage(language)) ??
            acceptedLanguage(c.req.header('Accept-Language')) ??
            DEFAULT_LANGUAGE;
        const suggestions = await context.timing.measure('compute', async () =>
            buildSuggestions(snapshot, lang)
        );
        return c.json({ suggestions }, 200);
    });

    app.openapi(reportRoute, async c => {
        const context = c.var.appContext;
        const { bookId } = c.req.valid('param');
        const body = c.req.valid('json');
        const snapshot = await readableSnapshot(context, bookId);
        const result = await createReport(
            snapshot,
            reportRequest(body),
            {
                requested: body.language && supportedLanguage(body.language),
                accepted: acceptedLanguage(c.req.header('Accept-Language')),
            },
            {
                decisions: context.decisions,
                readBalances: query => context.readBalances(snapshot.book, query),
                timing: context.timing,
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

/** The Book snapshot, for a user who may read the Book's balances. */
async function readableSnapshot(context: AppContext, bookId: string): Promise<Snapshot> {
    const snapshot = await loadSnapshot(bookId, {
        bkper: context.bkper,
        kv: context.env.KV,
        timing: context.timing,
        defer: context.defer,
    });
    requireViewPermission(snapshot.book.permission);
    return snapshot;
}
