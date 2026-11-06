import type { Context, MiddlewareHandler } from 'hono';
import { Bkper, Book, type BalancesReport } from 'bkper-js';
import type { Env } from '../../env.js';
import { createDecisionClient, type DecisionClient } from './services/decision-client.js';
import type { Snapshot } from './services/snapshot.js';
import { ServerTiming } from './services/timing.js';

/** Keeps work running after the response is sent. */
export type Defer = (task: Promise<unknown>) => void;

/** The Bkper calls the app makes: it only reads. */
export type BkperReader = Pick<Bkper, 'getUser' | 'getBook' | 'getConfig'>;

/** Runs one balances query on a Book. */
export type BalancesReader = (book: Snapshot['book'], query: string) => Promise<BalancesReport>;

export interface AppContextOptions {
    timing?: ServerTiming;
    defer?: Defer;
    decisions?: DecisionClient;
    readBalances?: BalancesReader;
}

export class AppContext {
    readonly bkper: BkperReader;
    readonly env: Env;
    /** What this request measures, sent back in the `Server-Timing` header. */
    readonly timing: ServerTiming;
    /** Present when the runtime can run work after the response. */
    readonly defer?: Defer;
    /** Bkper AI decision models, authorized by platform outbound. */
    readonly decisions: DecisionClient;
    readonly readBalances: BalancesReader;

    constructor(bkper: BkperReader, env: Env, options: AppContextOptions = {}) {
        this.bkper = bkper;
        this.env = env;
        this.timing = options.timing ?? new ServerTiming();
        this.defer = options.defer;
        this.decisions = options.decisions ?? createDecisionClient();
        // The snapshot already holds what queries need of the Book, so it is not loaded again.
        this.readBalances =
            options.readBalances ??
            ((book, query) =>
                new Book(
                    { id: book.id, timeZone: book.timeZone, fractionDigits: book.fractionDigits },
                    bkper.getConfig()
                ).getBalancesReport(query));
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
    return new AppContext(new Bkper(), c.env, { defer: waitUntil(c) });
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
        await appContext.timing.measure('total', next);
        const timing = appContext.timing.header();
        if (timing) {
            c.res.headers.append('Server-Timing', timing);
        }
    };
}
