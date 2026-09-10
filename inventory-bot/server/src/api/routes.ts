import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Bkper } from 'bkper-js';
import type { AppEnv } from '../index.js';
import { AppContext } from '../shared/app-context.js';
import { CalculateService } from './services/calculate-service.js';
import { ResetService } from './services/reset-service.js';
import {
    apiErrorResponses,
    BookAccountIdParamSchema,
    CalculateRequestSchema,
    jsonResponse,
    OperationResponseSchema,
} from './schemas.js';

const calculateRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/accounts/{accountId}/calculate',
    request: {
        params: BookAccountIdParamSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: CalculateRequestSchema } },
        },
    },
    responses: {
        200: jsonResponse('Calculate completed', OperationResponseSchema),
        ...apiErrorResponses,
    },
});

const resetRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/accounts/{accountId}/reset',
    request: {
        params: BookAccountIdParamSchema,
    },
    responses: {
        200: jsonResponse('Reset completed', OperationResponseSchema),
        ...apiErrorResponses,
    },
});

export function registerApiRoutes(app: OpenAPIHono<AppEnv>): void {
    app.openapi(calculateRoute, async c => {
        const { bookId, accountId } = c.req.valid('param');
        const request = c.req.valid('json');
        const context = new AppContext(new Bkper(), c.env);
        const response = await CalculateService.execute(context, bookId, accountId, request);
        return c.json(response, 200);
    });

    app.openapi(resetRoute, async c => {
        const { bookId, accountId } = c.req.valid('param');
        const context = new AppContext(new Bkper(), c.env);
        const response = await ResetService.execute(context, bookId, accountId);
        return c.json(response, 200);
    });
}
