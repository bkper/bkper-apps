import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { supportedLanguage } from 'report-shared/languages';
import { HTTPException } from 'hono/http-exception';
import type { AppContext, AppEnv } from '../app-context.js';
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
        'Up to three example requests the Book can answer, each with its intent. Requesting a report by one of these intents needs no AI.',
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
    summary: 'Build a report of a Book',
    description:
        'Builds a financial report from a request in any language (`prompt`) or from an `intent`. Numbers are computed from the Book balances; the Book is never changed.',
    request: {
        params: BookParamsSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: ReportRequestSchema } },
        },
    },
    responses: {
        200: jsonResponse('The report', ReportResponseSchema),
        422: jsonResponse(
            'Not a report of this Book (`not_a_report`, with suggestions), a period that has not started (`future_period`) or an unknown root (`unknown_root`)',
            ReportErrorResponseSchema
        ),
        429: jsonResponse(
            'Bkper AI allowance exhausted (`ai_allowance_exhausted`)',
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
        return c.json({ ...report, url: reportAppUrl(c.req.url, bookId, text) }, 200);
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
