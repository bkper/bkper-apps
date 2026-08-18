import { OpenAPIHono } from '@hono/zod-openapi';
import { BkperError } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import { buildApiError } from './api/errors';
import { registerApiRoutes } from './api/routes';
import { BkperAiError } from './services/bkper-ai-service';
import {
    appContextMiddleware,
    createAppContext,
    type AppContextFactory,
    type AppEnv,
} from './app-context';

export function createApp(createContext: AppContextFactory = createAppContext) {
    const app = new OpenAPIHono<AppEnv>({
        defaultHook: (result, c) => {
            if (!result.success) {
                const message = result.error.issues[0]?.message ?? 'Invalid request';
                return c.json(buildApiError('INVALID_REQUEST', message), 400);
            }
        },
    });

    app.onError((error, c) => {
        if (!c.req.path.startsWith('/api/')) {
            console.error(error);
            return c.json({ error: 'Internal Server Error' }, 500);
        }
        if (error instanceof HTTPException) {
            return c.json(buildApiError('REQUEST_FAILED', error.message), error.status);
        }
        if (error instanceof BkperAiError) {
            const body = buildApiError(error.code, error.message);
            if (error.status === 400) return c.json(body, 400);
            if (error.status === 401) return c.json(body, 401);
            if (error.status === 402) return c.json(body, 402);
            if (error.status === 403) return c.json(body, 403);
            if (error.status === 429) return c.json(body, 429);
            if (error.status === 502) return c.json(body, 502);
            return c.json(body, 500);
        }
        if (error instanceof BkperError) {
            if (error.code === 400) return c.json(buildApiError('BKPER_ERROR', error.message), 400);
            if (error.code === 401) return c.json(buildApiError('BKPER_ERROR', error.message), 401);
            if (error.code === 403) return c.json(buildApiError('BKPER_ERROR', error.message), 403);
            if (error.code === 404) return c.json(buildApiError('BKPER_ERROR', error.message), 404);
            if (error.code === 409) return c.json(buildApiError('BKPER_ERROR', error.message), 409);
            if (error.code === 429) return c.json(buildApiError('BKPER_ERROR', error.message), 429);
        }
        console.error(error);
        return c.json(
            buildApiError(
                'INTERNAL_ERROR',
                error instanceof Error ? error.message : 'An unexpected error occurred.'
            ),
            500
        );
    });

    app.get('/health', c => c.json({ status: 'ok' }));
    app.use('/api/*', appContextMiddleware(createContext));
    registerApiRoutes(app);
    app.get('*', c => c.env.ASSETS.fetch(c.req.raw));
    return app;
}

export default createApp();
export { buildApiError };
