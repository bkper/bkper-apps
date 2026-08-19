import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../index.js';
import { ApiErrorSchema } from './schemas.js';

export function registerApiRoutes(app: OpenAPIHono<AppEnv>): void {
    app.openAPIRegistry.register('ApiError', ApiErrorSchema);
}
