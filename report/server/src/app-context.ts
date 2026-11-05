import type { Context, MiddlewareHandler } from 'hono';
import { Bkper } from 'bkper-js';
import type { Env } from '../../env.js';
import { ServerTiming } from './services/timing.js';

/** Keeps work running after the response is sent. */
export type Defer = (task: Promise<unknown>) => void;

export class AppContext {
    readonly bkper: Bkper;
    readonly env: Env;
    /** What this request measures, sent back in the `Server-Timing` header. */
    readonly timing: ServerTiming;
    /** Present when the runtime can run work after the response. */
    readonly defer?: Defer;

    constructor(bkper: Bkper, env: Env, timing = new ServerTiming(), defer?: Defer) {
        this.bkper = bkper;
        this.env = env;
        this.timing = timing;
        this.defer = defer;
    }
}

export interface AppVariables {
    appContext: AppContext;
}

export type AppEnv = {
    Bindings: Env;
    Variables: AppVariables;
};

export type WorkerContext = Context<AppEnv>;
export type AppContextFactory = (c: WorkerContext) => AppContext;

// Platform outbound auth injects the validated user/app token for server-side Bkper calls.
export function createAppContext(c: WorkerContext): AppContext {
    return new AppContext(new Bkper(), c.env, new ServerTiming(), waitUntil(c));
}

/** Hono throws when reading the execution context of a runtime without one, such as tests. */
function waitUntil(c: WorkerContext): Defer | undefined {
    let executionCtx: WorkerContext['executionCtx'];
    try {
        executionCtx = c.executionCtx;
    } catch {
        return undefined;
    }
    return task => executionCtx.waitUntil(task);
}

export function appContextMiddleware(
    createContext: AppContextFactory = createAppContext
): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const appContext = createContext(c);
        c.set('appContext', appContext);
        await next();
        const timing = appContext.timing.header();
        if (timing) {
            c.res.headers.append('Server-Timing', timing);
        }
    };
}
