import { Hono } from 'hono';
import type { Env } from '../../env.js';
import {
    defaultEventRouteDependencies,
    registerEventRoutes,
    type EventRouteDependencies,
} from './events/routes.js';

type AppEnv = { Bindings: Env };

export function createApp(
    eventDependencies: EventRouteDependencies = defaultEventRouteDependencies
): Hono<AppEnv> {
    const app = new Hono<AppEnv>();

    app.get('/health', c => c.json({ status: 'ok' }));
    registerEventRoutes(app, eventDependencies);

    return app;
}

const app = createApp();

export default app;
