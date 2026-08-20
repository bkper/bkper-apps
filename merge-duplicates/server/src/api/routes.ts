import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../app-context';
import { analyzeTransactions } from '../services/analyze-service';
import { saveRejectedExamples } from '../services/learning-service';
import { mergePair } from '../services/merge-service';
import { buildApiError } from './errors';
import { openApiDocumentConfig } from './openapi';
import {
    aiErrorResponses,
    AnalyzeRequestSchema,
    AnalyzeResponseSchema,
    apiErrorResponses,
    LearnRequestSchema,
    LearnResponseSchema,
    MergeRequestSchema,
    MergeResponseSchema,
    jsonResponse,
} from './schemas';

const analyzeRoute = createRoute({
    method: 'post',
    path: '/api/v1/analyze',
    tags: ['Duplicate review'],
    summary: 'Analyze up to 1,000 submitted Book transactions',
    request: {
        body: { required: true, content: { 'application/json': { schema: AnalyzeRequestSchema } } },
    },
    responses: {
        200: jsonResponse(
            'AI-ranked, deterministically non-overlapping suggestions',
            AnalyzeResponseSchema
        ),
        ...apiErrorResponses,
        ...aiErrorResponses,
    },
});

const mergeRoute = createRoute({
    method: 'post',
    path: '/api/v1/merge',
    tags: ['Duplicate review'],
    summary: 'Merge one confirmed pair with the canonical Bkper merge operation',
    request: {
        body: { required: true, content: { 'application/json': { schema: MergeRequestSchema } } },
    },
    responses: {
        200: jsonResponse('Full canonical merged transaction', MergeResponseSchema),
        ...apiErrorResponses,
    },
});

const learnRoute = createRoute({
    method: 'post',
    path: '/api/v1/learn',
    tags: ['Duplicate review'],
    summary: 'Save rejected pairs as plain-text learning examples',
    request: {
        body: { required: true, content: { 'application/json': { schema: LearnRequestSchema } } },
    },
    responses: {
        200: jsonResponse('Full updated learning resource', LearnResponseSchema),
        ...apiErrorResponses,
    },
});

export function registerApiRoutes(app: OpenAPIHono<AppEnv>): void {
    app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
        type: 'http',
        scheme: 'bearer',
    });

    app.openapi(analyzeRoute, async c => {
        const result = await analyzeTransactions(c.get('appContext'), c.req.valid('json'));
        return c.json(result, 200);
    });

    app.openapi(mergeRoute, async c => {
        const result = await mergePair(c.get('appContext'), c.req.valid('json'));
        return c.json(result, 200);
    });

    app.openapi(learnRoute, async c => {
        const result = await saveRejectedExamples(c.get('appContext'), c.req.valid('json'));
        return c.json(result, 200);
    });

    app.doc('/openapi.json', openApiDocumentConfig);
    app.all('/api/*', c =>
        c.json(buildApiError('NOT_FOUND', `Route not found: ${c.req.method} ${c.req.path}`), 404)
    );
}
