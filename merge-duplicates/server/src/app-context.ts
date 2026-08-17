import type { Context, MiddlewareHandler } from 'hono';
import { Bkper } from 'bkper-js';
import type { Env } from '../../env.js';

export class AppContext {
    constructor(
        readonly bkper: Bkper,
        readonly env: Env,
        readonly aiFetch: typeof fetch = fetch
    ) {}
}

export interface AppVariables {
    appContext: AppContext;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
export type WorkerContext = Context<AppEnv>;
export type AppContextFactory = (c: WorkerContext) => AppContext;

export function createAppContext(c: WorkerContext): AppContext {
    return new AppContext(new Bkper(), c.env);
}

export function appContextMiddleware(
    createContext: AppContextFactory = createAppContext
): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        c.set('appContext', createContext(c));
        await next();
    };
}
