import { OpenAPIHono } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import type { ZodError } from 'zod';
import { apiErrorResponse, buildApiError } from './api/errors.js';
import { registerApiRoutes } from './api/routes.js';
import {
    appContextMiddleware,
    createAppContext,
    type AppContextFactory,
    type AppEnv,
} from './app-context.js';

export function createApp(createContext: AppContextFactory = createAppContext) {
    const app = new OpenAPIHono<AppEnv>({
        defaultHook: (result, c) => {
            if (!result.success) {
                return c.json(buildApiError('invalid_request', issueMessage(result.error)), 400);
            }
        },
    });

    app.use(logger());
    app.use(prettyJSON());

    app.onError((err, c) => {
        if (c.req.path.startsWith('/api/')) {
            const known = apiErrorResponse(err);
            if (known) {
                return c.json(known.body, known.status);
            }
            console.error(err);
            return c.json(buildApiError('internal_error', 'An unexpected error occurred'), 500);
        }
        console.error(err);
        return c.json({ error: err.message }, 500);
    });

    app.get('/health', c => c.json({ status: 'ok' }));

    app.use('/api/*', appContextMiddleware(createContext));

    registerApiRoutes(app);

    app.get('*', c => c.env.ASSETS.fetch(c.req.raw));

    return app;
}

/** The first issue of a validation error, after the path of the field it is about. */
function issueMessage(error: ZodError): string {
    const issue = error.issues[0];
    if (!issue) {
        return 'Invalid request';
    }
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
}

const app = createApp();

export default app;
export { buildApiError };
