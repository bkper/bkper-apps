import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../app-context';
import { saveRejectedPair } from '../services/learning-service';
import { mergePair } from '../services/merge-service';
import { scanTransactions } from '../services/scan-service';
import { buildApiError } from './errors';
import { openApiDocumentConfig } from './openapi';
import {
    aiErrorResponses,
    apiErrorResponses,
    LearnRequestSchema,
    LearnResponseSchema,
    MergeRequestSchema,
    MergeResponseSchema,
    ScanRequestSchema,
    ScanResponseSchema,
    jsonResponse,
} from './schemas';

const scanRoute = createRoute({
    method: 'post',
    path: '/api/v1/scan',
    tags: ['Duplicate review'],
    summary: 'Scan one page of 200 transactions',
    request: {
        body: { required: true, content: { 'application/json': { schema: ScanRequestSchema } } },
    },
    responses: {
        200: jsonResponse(
            'AI-ranked, deterministically non-overlapping suggestions',
            ScanResponseSchema
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
        200: jsonResponse('Canonical merged transaction', MergeResponseSchema),
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
        200: jsonResponse('Learning result', LearnResponseSchema),
        ...apiErrorResponses,
    },
});

export function registerApiRoutes(app: OpenAPIHono<AppEnv>): void {
    app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
        type: 'http',
        scheme: 'bearer',
    });

    app.openapi(scanRoute, async c => {
        const result = await scanTransactions(c.get('appContext'), c.req.valid('json'));
        return c.json(result, 200);
    });

    app.openapi(mergeRoute, async c => {
        const result = await mergePair(c.get('appContext'), c.req.valid('json'));
        return c.json(result, 200);
    });

    app.openapi(learnRoute, async c => {
        const result = await saveRejectedPair(c.get('appContext'), c.req.valid('json'));
        return c.json(result, 200);
    });

    app.doc('/openapi.json', openApiDocumentConfig);
    app.all('/api/*', c =>
        c.json(buildApiError('NOT_FOUND', `Route not found: ${c.req.method} ${c.req.path}`), 404)
    );
}
