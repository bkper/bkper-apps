import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { openApiDocumentConfig } from './openapi.js';
import { apiErrorResponses, jsonResponse, PingResponseSchema } from './schemas.js';
import { buildApiError } from './errors.js';
import type { AppEnv } from '../app-context.js';

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

export function registerApiRoutes(app: App): void {
    app.openapi(pingRoute, c => c.json({ ok: true, source: 'report' }, 200));

    app.doc('/openapi.json', openApiDocumentConfig);

    app.all('/api/*', c =>
        c.json(buildApiError('NOT_FOUND', `Route not found: ${c.req.method} ${c.req.path}`), 404)
    );
}
