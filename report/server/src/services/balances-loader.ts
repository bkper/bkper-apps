/**
 * Loads the balances of a report's queries for the current user: each from KV when the same
 * exact query was read in the last minute, otherwise from Bkper, all in parallel.
 */
import type { BalancesReport } from 'bkper-js';
import { readQueryBalances, type QueryBalances } from './balances.js';
import type { IsoDate } from './periods.js';
import type { SnapshotStore } from './snapshot-loader.js';
import type { Timing } from './timing.js';

/** How long the balances of a query are reused; they may be this much behind the Book. */
export const BALANCES_TTL_SECONDS = 60;

export interface BalancesLoaderOptions {
    userId: string;
    bookId: string;
    /** The Book's today, `YYYY-MM-DD`, from which Bkper resolves `$d`, `$m` and `$y`. */
    today: IsoDate;
    kv: SnapshotStore;
    timing: Timing;
    /** Runs one balances query on the Book. */
    read: (query: string) => Promise<BalancesReport>;
    now?: () => Date;
    /** Keeps work running after the response, such as `waitUntil`; without it, work is awaited. */
    defer?: (task: Promise<unknown>) => void;
}

/**
 * One entry per user, Book, day and exact query: balances are only served to the user they were
 * read for, and a query of relative dates (`on:$m`, `before:$d+1`) only on the Book's day it was
 * read, as Bkper resolves those dates from it. The query is hashed, as KV keys are limited to
 * 512 bytes and names are not. `v3` entries hold the range Bkper read, which `v2` ones lack;
 * `v2` ones hold each node's nature and each group's children, which `v1` ones lack.
 */
export async function balancesKey(
    userId: string,
    bookId: string,
    today: IsoDate,
    query: string
): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'));
    return `balances:v3:${userId}:${bookId}:${today}:${hash.join('')}`;
}

/** The balances of each query, in query order; a query asked twice is read once. */
export async function loadBalances(
    queries: string[],
    options: BalancesLoaderOptions
): Promise<QueryBalances[]> {
    const { kv, timing } = options;
    const unique = [...new Set(queries)];
    const keys = await Promise.all(
        unique.map(query => balancesKey(options.userId, options.bookId, options.today, query))
    );
    const cached = await timing.measure('kv', () => Promise.all(keys.map(key => kv.get(key))));
    const found = new Map<string, QueryBalances>();
    const missing: { query: string; key: string }[] = [];
    unique.forEach((query, i) => {
        const value = cached[i];
        if (value === null) {
            missing.push({ query, key: keys[i] });
        } else {
            found.set(query, JSON.parse(value) as QueryBalances);
        }
    });

    if (missing.length > 0) {
        const read = await timing.measure('balances', () =>
            Promise.all(
                missing.map(async ({ query }) => {
                    const asked = options.now?.() ?? new Date();
                    return readQueryBalances(query, await options.read(query), asked);
                })
            )
        );
        const stores = read.map((balances, i) => {
            found.set(balances.query, balances);
            return kv.put(missing[i].key, JSON.stringify(balances), {
                expirationTtl: BALANCES_TTL_SECONDS,
            });
        });
        const stored = Promise.all(stores);
        if (options.defer) {
            options.defer(stored);
        } else {
            await timing.measure('kv', () => stored);
        }
    }
    return queries.map(query => {
        const balances = found.get(query);
        if (!balances) {
            throw new Error('A balances query was not read');
        }
        return balances;
    });
}
