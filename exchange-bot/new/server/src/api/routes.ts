import { createRoute, z } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Bkper } from 'bkper-js';
import { AppContext } from '../app-context.js';
import type { AppEnv } from '../index.js';
import { ExchangeRatesService } from '../services/exchange-rates-service.js';
import { ExchangeUpdateService } from '../services/exchange-update-service.js';
import {
    apiErrorResponses,
    BookIdParamSchema,
    BkperTransactionSchema,
    ExchangeRatesDateQuerySchema,
    ExchangeRatesSchema,
    jsonResponse,
} from './schemas.js';

const exchangeRatesRoute = createRoute({
    method: 'get',
    path: '/api/v1/books/{bookId}/exchange-rates',
    request: {
        params: BookIdParamSchema,
        query: ExchangeRatesDateQuerySchema,
    },
    responses: {
        200: jsonResponse('Exchange rates', ExchangeRatesSchema),
        ...apiErrorResponses,
    },
});

const exchangeUpdateRoute = createRoute({
    method: 'post',
    path: '/api/v1/books/{bookId}/exchange-update',
    request: {
        params: BookIdParamSchema,
        body: {
            required: true,
            content: { 'application/json': { schema: ExchangeRatesSchema } },
        },
    },
    responses: {
        200: jsonResponse('Accepted exchange transactions', z.array(BkperTransactionSchema)),
        ...apiErrorResponses,
    },
});

export function registerApiRoutes(app: OpenAPIHono<AppEnv>): void {
    app.openapi(exchangeRatesRoute, async c => {
        const { bookId } = c.req.valid('param');
        const { date } = c.req.valid('query');
        const context = new AppContext(new Bkper(), c.env);
        return c.json(await ExchangeRatesService.load(context, bookId, date), 200);
    });

    app.openapi(exchangeUpdateRoute, async c => {
        const { bookId } = c.req.valid('param');
        const exchangeRates = c.req.valid('json');
        const context = new AppContext(new Bkper(), c.env);
        return c.json(await ExchangeUpdateService.update(context, bookId, exchangeRates), 200);
    });
}
