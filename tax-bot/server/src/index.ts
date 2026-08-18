import { Hono } from 'hono';
import type { Env } from '../../env.js';
import { registerEventRoutes } from './events/routes.js';

type AppEnv = { Bindings: Env };

export function createApp(): Hono<AppEnv> {
    const app = new Hono<AppEnv>();

    registerEventRoutes(app);

    return app;
}

const app = createApp();

export default app;
