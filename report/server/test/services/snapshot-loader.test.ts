import { BalancesReport, Book, User } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    SNAPSHOT_TTL_SECONDS,
    loadSnapshot,
    snapshotKey,
    type SnapshotLoaderOptions,
    type SnapshotStore,
} from '../../src/services/snapshot-loader';
import { ServerTiming } from '../../src/services/timing';
import { createTestEnv } from '../test-env';
import { balancesPayloads, bookPayload } from '../fixtures/snapshot-book';

/** 2026-11-05 at noon in São Paulo, the Book time zone. */
const NOW = new Date('2026-11-05T15:00:00Z');

class FakeBkper {
    readonly bookLoads: { id: string; accounts?: boolean; groups?: boolean }[] = [];
    readonly queries: string[] = [];
    /** Queries started while others were still running. */
    maxInFlight = 0;
    private inFlight = 0;

    constructor(private readonly userId = 'user-1') {}

    async getUser(): Promise<User> {
        return new User({ id: this.userId });
    }

    async getBook(id: string, accounts?: boolean, groups?: boolean): Promise<Book> {
        this.bookLoads.push({ id, accounts, groups });
        const book = new Book(structuredClone(bookPayload));
        book.getBalancesReport = async (query: string) => {
            this.queries.push(query);
            this.inFlight++;
            this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            this.inFlight--;
            const payload = balancesPayloads[query];
            if (!payload) {
                throw new Error(`Unexpected query: ${query}`);
            }
            return new BalancesReport(book, payload);
        };
        return book;
    }
}

function options(
    bkper: FakeBkper,
    kv: SnapshotStore = createTestEnv().KV
): SnapshotLoaderOptions & {
    timing: ServerTiming;
} {
    return { bkper, kv, timing: new ServerTiming(), now: () => NOW };
}

describe('loadSnapshot', () => {
    it('loads the Book with its groups and accounts, then every root query in parallel', async () => {
        const bkper = new FakeBkper();
        const snapshot = await loadSnapshot('book-1', options(bkper));

        expect(bkper.bookLoads).toEqual([{ id: 'book-1', accounts: true, groups: true }]);
        // 2 position roots + 3 activity roots, each with 3 comparison windows.
        expect(bkper.queries).toHaveLength(2 + 3 * 4);
        expect(bkper.maxInFlight).toBe(bkper.queries.length);
        expect(bkper.queries).toContain("group:'Assets' before:2026-11-06 by:m");
        expect(snapshot.today).toBe('2026-11-05');
        expect(snapshot.dataAt).toBe(NOW.toISOString());
        expect(snapshot.roots).toHaveLength(5);
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
        await loadSnapshot('book-1', options(new FakeBkper('user-1'), kv));
        const other = new FakeBkper('user-2');
        await loadSnapshot('book-1', options(other, kv));
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

    it('reports user, kv and balances timings', async () => {
        const cold = options(new FakeBkper());
        await loadSnapshot('book-1', cold);
        expect(cold.timing.header()).toMatch(
            /^user;dur=[\d.]+, kv;dur=[\d.]+, balances;dur=[\d.]+$/
        );

        const warm = options(new FakeBkper(), cold.kv);
        await loadSnapshot('book-1', warm);
        expect(warm.timing.header()).toMatch(/^user;dur=[\d.]+, kv;dur=[\d.]+$/);
    });

    it('fails without caching when a query fails', async () => {
        const kv = createTestEnv().KV;
        const bkper = new FakeBkper();
        const getBook = bkper.getBook.bind(bkper);
        bkper.getBook = async (id, accounts, groups) => {
            const book = await getBook(id, accounts, groups);
            book.getBalancesReport = async () => {
                throw new Error('upstream');
            };
            return book;
        };
        await expect(loadSnapshot('book-1', options(bkper, kv))).rejects.toThrow('upstream');
        expect(await kv.get(snapshotKey('user-1', 'book-1'))).toBeNull();
    });
});
