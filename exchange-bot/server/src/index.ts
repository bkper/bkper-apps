import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { BkperError } from 'bkper-js';
import type { Env } from '../../env.js';
import { apiError } from './api/errors.js';
import { registerApiRoutes } from './api/routes.js';
import { registerEventRoutes } from './events/routes.js';

export type AppEnv = { Bindings: Env };

export const openApiConfig = {
    openapi: '3.0.0' as const,
    info: { title: 'Exchange Bot API', version: '1.0.0' },
};

export function createApp(): OpenAPIHono<AppEnv> {
    const app = new OpenAPIHono<AppEnv>({
        defaultHook: (result, c) => {
            if (!result.success) {
                const message = result.error.issues[0]?.message ?? 'Invalid request';
                return c.json(apiError(message), 400);
            }
        },
    });

    app.onError((error, c) => {
        if (c.req.path.startsWith('/api/')) {
            if (error instanceof HTTPException) {
                return c.json(apiError(error.message), error.status);
            }
            if (error instanceof BkperError && error.code === 403) {
                return c.json(apiError(error.message), 403);
            }
            console.error(error);
            return c.json(apiError('An unexpected error occurred'), 500);
        }
        if (error instanceof HTTPException) {
            return error.getResponse();
        }
        console.error(error);
        return c.text('Internal Server Error', 500);
    });

    registerEventRoutes(app);
    registerApiRoutes(app);

    app.doc('/openapi.json', openApiConfig);

    app.all('/api/*', c => c.json(apiError(`Route not found: ${c.req.method} ${c.req.path}`), 404));

    app.get('*', c => c.env.ASSETS.fetch(c.req.raw));

    return app;
}

export default createApp();
