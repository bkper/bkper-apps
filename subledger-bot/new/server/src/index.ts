import { Hono } from 'hono';
import type { Env } from '../../env.js';
import { registerEventRoutes } from './events/routes.js';

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

app.get('/health', c => c.json({ status: 'ok' }));
registerEventRoutes(app);

export default app;
