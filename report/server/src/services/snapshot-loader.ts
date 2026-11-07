/**
 * Loads the snapshot (the map) of a Book for the current user: from KV when a recent one
 * exists, otherwise from Bkper, with every root's query in parallel.
 */
import type { Bkper } from 'bkper-js';
import { todayInTimeZone } from './periods.js';
import { buildSnapshot, snapshotQueries, type Snapshot } from './snapshot.js';
import type { Timing } from './timing.js';

/** How long a snapshot is reused; the map may be this much behind the Book. */
export const SNAPSHOT_TTL_SECONDS = 60;

/** The part of Workers KV the cache uses. */
export interface SnapshotStore {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

export interface SnapshotLoaderOptions {
    /** The current user, whose cache entries these are (see {@link currentUserId}). */
    userId: string;
    bkper: Pick<Bkper, 'getBook'>;
    kv: SnapshotStore;
    timing: Timing;
    now?: () => Date;
    /** Keeps work running after the response, such as `waitUntil`; without it, work is awaited. */
    defer?: (task: Promise<unknown>) => void;
}

/** One snapshot per user and Book: a cached snapshot is only served to the user it was read for. */
export function snapshotKey(userId: string, bookId: string): string {
    return `snapshot:v2:${userId}:${bookId}`;
}

/** The id of the current user, which every cache key needs: Dispatch passes no identity. */
export async function currentUserId(
    bkper: Pick<Bkper, 'getUser'>,
    timing: Timing
): Promise<string> {
    const user = await timing.measure('user', () => bkper.getUser());
    const userId = user.getId();
    if (!userId) {
        throw new Error('The current user has no id');
    }
    return userId;
}

export async function loadSnapshot(
    bookId: string,
    options: SnapshotLoaderOptions
): Promise<Snapshot> {
    const { bkper, kv, timing } = options;
    const key = snapshotKey(options.userId, bookId);
    const cached = await timing.measure('kv', () => kv.get(key));
    if (cached !== null) {
        return JSON.parse(cached) as Snapshot;
    }

    const now = options.now?.() ?? new Date();
    const snapshot = await timing.measure('balances', () => readSnapshot(bkper, bookId, now));
    const store = kv.put(key, JSON.stringify(snapshot), { expirationTtl: SNAPSHOT_TTL_SECONDS });
    if (options.defer) {
        options.defer(store);
    } else {
        await timing.measure('kv', () => store);
    }
    return snapshot;
}

async function readSnapshot(
    bkper: Pick<Bkper, 'getBook'>,
    bookId: string,
    now: Date
): Promise<Snapshot> {
    const book = await bkper.getBook(bookId, true, true);
    // Both come from the Book payload just loaded, without further requests.
    const groups = await book.getGroups();
    const accounts = await book.getAccounts();
    const today = todayInTimeZone(now, book.getTimeZone());
    const roots = groups
        .filter(group => !group.hasParent())
        .map(group => ({ name: group.getName() ?? '' }));
    const results = await Promise.all(
        snapshotQueries(roots, today).map(async query => ({
            query,
            report: await book.getBalancesReport(query.query),
        }))
    );
    return buildSnapshot({ book, groups, accounts, results, today, dataAt: now });
}
