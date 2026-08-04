import { OpenAPIHono } from '@hono/zod-openapi';
import type { Env } from '../../env.js';

export type AppEnv = { Bindings: Env };

export const openApiConfig = {
    openapi: '3.0.0' as const,
    info: { title: 'Exchange Bot API', version: '1.0.0' },
};

export function createApp(): OpenAPIHono<AppEnv> {
    const app = new OpenAPIHono<AppEnv>();

    app.get('/health', c => c.json({ status: 'ok' }));

    app.post('/events', async c => {
        const event: bkper.Event = await c.req.json();
        void event;
        return c.json({ result: false });
    });

    app.doc('/openapi.json', openApiConfig);

    app.all('/api/v1/*', c =>
        c.json(
            {
                success: false as const,
                error: {
                    code: 'NOT_FOUND',
                    message: `Route not found: ${c.req.method} ${c.req.path}`,
                },
            },
            404
        )
    );

    app.all('/api/*', c =>
        c.json(
            {
                success: false as const,
                error: {
                    code: 'NOT_FOUND',
                    message: `Route not found: ${c.req.method} ${c.req.path}`,
                },
            },
            404
        )
    );

    app.get('*', c => c.env.ASSETS.fetch(c.req.raw));

    return app;
}

export default createApp();
