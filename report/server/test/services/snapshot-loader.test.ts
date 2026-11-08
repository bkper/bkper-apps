import { Book, User } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    SNAPSHOT_TTL_SECONDS,
    currentUserId,
    loadSnapshot,
    snapshotKey,
    type SnapshotLoaderOptions,
    type SnapshotStore,
} from '../../src/services/snapshot-loader';
import { ServerTiming } from '../../src/services/timing';
import { createTestEnv } from '../test-env';
import { bookPayload } from '../fixtures/snapshot-book';

/** 2026-11-05 at noon in São Paulo, the Book time zone. */
const NOW = new Date('2026-11-05T15:00:00Z');

class FakeBkper {
    readonly bookLoads: { id: string; accounts?: boolean; groups?: boolean }[] = [];
    /** Balances queries asked of the Book: the map must ask none. */
    readonly queries: string[] = [];

    constructor(private readonly userId = 'user-1') {}

    async getUser(): Promise<User> {
        return new User({ id: this.userId });
    }

    async getBook(id: string, accounts?: boolean, groups?: boolean): Promise<Book> {
        this.bookLoads.push({ id, accounts, groups });
        const book = new Book(structuredClone(bookPayload));
        book.getBalancesReport = async (query: string) => {
            this.queries.push(query);
            throw new Error('The map reads no balances');
        };
        return book;
    }
}

function options(
    bkper: FakeBkper,
    kv: SnapshotStore = createTestEnv().KV,
    userId = 'user-1'
): SnapshotLoaderOptions & {
    timing: ServerTiming;
} {
    return { userId, bkper, kv, timing: new ServerTiming(), now: () => NOW };
}

describe('loadSnapshot', () => {
    it('builds the map from one load of the Book, with no balances query', async () => {
        const bkper = new FakeBkper();
        const snapshot = await loadSnapshot('book-1', options(bkper));

        expect(bkper.bookLoads).toEqual([{ id: 'book-1', accounts: true, groups: true }]);
        expect(bkper.queries).toEqual([]);
        expect(snapshot.today).toBe('2026-11-05');
        expect(snapshot.dataAt).toBe(NOW.toISOString());
        expect(snapshot.roots).toHaveLength(5);
        expect(Object.keys(snapshot.accounts)).toHaveLength(8);
    });

    it('caches the snapshot for 60 seconds per user and Book', async () => {
        const kv = createTestEnv().KV;
        const puts: { key: string; ttl?: number }[] = [];
        const put = kv.put;
        kv.put = async (key, value, ttl?: { expirationTtl?: number }) => {
            puts.push({ key, ttl: ttl?.expirationTtl });
            return put(key, value);
        };

        const first = await loadSnapshot('book-1', options(new FakeBkper(), kv));
        const warm = new FakeBkper();
        const second = await loadSnapshot('book-1', options(warm, kv));

        expect(SNAPSHOT_TTL_SECONDS).toBe(60);
        expect(puts).toEqual([{ key: snapshotKey('user-1', 'book-1'), ttl: 60 }]);
        expect(warm.bookLoads).toEqual([]);
        expect(second).toEqual(first);
    });

    it('does not share a snapshot between users', async () => {
        const kv = createTestEnv().KV;
        await loadSnapshot('book-1', options(new FakeBkper(), kv, 'user-1'));
        const other = new FakeBkper();
        await loadSnapshot('book-1', options(other, kv, 'user-2'));
        expect(other.bookLoads).toHaveLength(1);
        expect(snapshotKey('user-1', 'book-1')).not.toBe(snapshotKey('user-2', 'book-1'));
    });

    it('stores in the background when it can, so the response does not wait', async () => {
        const kv = createTestEnv().KV;
        const deferred: Promise<unknown>[] = [];
        await loadSnapshot('book-1', {
            ...options(new FakeBkper(), kv),
            defer: task => deferred.push(task),
        });
        expect(deferred).toHaveLength(1);
        await Promise.all(deferred);
        expect(await kv.get(snapshotKey('user-1', 'book-1'))).not.toBeNull();
    });

    it('reports kv and book timings', async () => {
        const cold = options(new FakeBkper());
        await loadSnapshot('book-1', cold);
        expect(cold.timing.header()).toMatch(/^kv;dur=[\d.]+, book;dur=[\d.]+$/);

        const warm = options(new FakeBkper(), cold.kv);
        await loadSnapshot('book-1', warm);
        expect(warm.timing.header()).toMatch(/^kv;dur=[\d.]+$/);
    });

    it('does not read a snapshot cached in an older shape', async () => {
        const kv = createTestEnv().KV;
        // v1 held amounts, v2 lacked the accounts in no group, v3 held months with movements,
        // v4 lacked which accounts have transactions posted.
        for (const version of ['v1', 'v2', 'v3', 'v4']) {
            await kv.put(`snapshot:${version}:user-1:book-1`, JSON.stringify({ stale: true }));
        }
        const snapshot = await loadSnapshot('book-1', options(new FakeBkper(), kv));
        expect(snapshot).not.toHaveProperty('stale');
        expect(snapshotKey('user-1', 'book-1')).toBe('snapshot:v5:user-1:book-1');
    });

    it('fails without caching when the Book fails to load', async () => {
        const kv = createTestEnv().KV;
        const bkper = new FakeBkper();
        bkper.getBook = async () => {
            throw new Error('upstream');
        };
        await expect(loadSnapshot('book-1', options(bkper, kv))).rejects.toThrow('upstream');
        expect(await kv.get(snapshotKey('user-1', 'book-1'))).toBeNull();
    });
});

describe('currentUserId', () => {
    it('identifies the user every cache key is for, measured as user', async () => {
        const timing = new ServerTiming();
        expect(await currentUserId(new FakeBkper('user-7'), timing)).toBe('user-7');
        expect(timing.header()).toMatch(/^user;dur=[\d.]+$/);
    });

    it('fails for a user without an id', async () => {
        const bkper = { getUser: async () => new User({}) };
        await expect(currentUserId(bkper, new ServerTiming())).rejects.toThrow('no id');
    });
});
