import { createRoute } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Bkper } from 'bkper-js';
import type { AppEnv } from '../index.js';
import { AppContext } from '../shared/app-context.js';
import { CalculateService } from './services/calculate-service.js';
import { ForwardService } from './services/forward-service.js';
import { ResetService } from './services/reset-service.js';
import {
    apiErrorResponses,
    BookAccountIdParamSchema,
    BookIdParamSchema,
    CalculateRequestSchema,
    ForwardRequestSchema,
    PendingCalculationAccountsSchema,
    jsonResponse,
} from './schemas.js';

const pendingCalculationRoute = createRoute({
    method: 'get',
    path: '/api/v1/books/{bookId}/accounts/pending-calculation',
    request: {
        params: BookIdParamSchema,
    },
    responses: {
        200: jsonResponse('Accounts pending calculation', PendingCalculationAccountsSchema),
        ...apiErrorResponses,
    },
});

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
        204: { description: 'Calculate completed' },
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
        204: { description: 'Reset completed' },
        ...apiErrorResponses,
    },
});

const fullResetRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/accounts/{accountId}/full-reset',
    request: {
        params: BookAccountIdParamSchema,
    },
    responses: {
        204: { description: 'Full Reset completed' },
        ...apiErrorResponses,
    },
});

const forwardRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/accounts/{accountId}/forward',
    request: {
        params: BookAccountIdParamSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: ForwardRequestSchema } },
        },
    },
    responses: {
        204: { description: 'Forward completed' },
        ...apiErrorResponses,
    },
});

export function registerApiRoutes(app: OpenAPIHono<AppEnv>): void {
    app.openapi(pendingCalculationRoute, async c => {
        const { bookId } = c.req.valid('param');
        const context = new AppContext(new Bkper(), c.env);
        const ids = await CalculateService.listAccountsPendingCalculation(context, bookId);
        return c.json({ ids }, 200);
    });

    app.openapi(calculateRoute, async c => {
        const { bookId, accountId } = c.req.valid('param');
        const request = c.req.valid('json');
        const context = new AppContext(new Bkper(), c.env);
        await CalculateService.calculate(context, bookId, accountId, request);
        return c.body(null, 204);
    });

    app.openapi(resetRoute, async c => {
        const { bookId, accountId } = c.req.valid('param');
        const context = new AppContext(new Bkper(), c.env);
        await ResetService.reset(context, bookId, accountId);
        return c.body(null, 204);
    });

    app.openapi(fullResetRoute, async c => {
        const { bookId, accountId } = c.req.valid('param');
        const context = new AppContext(new Bkper(), c.env);
        await ResetService.fullReset(context, bookId, accountId);
        return c.body(null, 204);
    });

    app.openapi(forwardRoute, async c => {
        const { bookId, accountId } = c.req.valid('param');
        const request = c.req.valid('json');
        const context = new AppContext(new Bkper(), c.env);
        await ForwardService.forward(context, bookId, accountId, request);
        return c.body(null, 204);
    });
}
