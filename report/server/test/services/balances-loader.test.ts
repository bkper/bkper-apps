import { BalancesReport, Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import {
    BALANCES_TTL_SECONDS,
    balancesKey,
    loadBalances,
    type BalancesLoaderOptions,
} from '../../src/services/balances-loader';
import { ServerTiming } from '../../src/services/timing';
import { bookPayload, fixtureLedger } from '../fixtures/snapshot-book';
import { createTestEnv } from '../test-env';

const NOW = new Date('2026-11-05T15:00:00Z');
const LAST_MONTH = "group:'Expenses' after:2026-10-01 before:2026-11-01 by:m";
const MONTH_BEFORE = "group:'Expenses' after:2026-09-01 before:2026-10-01 by:m";

interface TestOptions extends BalancesLoaderOptions {
    timing: ServerTiming;
    /** The queries read from Bkper, in order. */
    reads: string[];
    /** The most queries read at once. */
    maxInFlight: number;
}

function options(overrides: Partial<Omit<BalancesLoaderOptions, 'timing'>> = {}): TestOptions {
    const ledger = fixtureLedger();
    let inFlight = 0;
    const test: TestOptions = {
        userId: 'user-1',
        bookId: 'book-1',
        kv: createTestEnv().KV,
        timing: new ServerTiming(),
        now: () => NOW,
        reads: [],
        maxInFlight: 0,
        read: async query => {
            test.reads.push(query);
            inFlight++;
            test.maxInFlight = Math.max(test.maxInFlight, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight--;
            return new BalancesReport(new Book(bookPayload), ledger.balances(query));
        },
        ...overrides,
    };
    return test;
}

describe('loadBalances', () => {
    it('reads every query in parallel, each once, and answers in query order', async () => {
        const test = options();
        const [last, before, again] = await loadBalances(
            [LAST_MONTH, MONTH_BEFORE, LAST_MONTH],
            test
        );
        expect(test.reads).toEqual([LAST_MONTH, MONTH_BEFORE]);
        expect(test.maxInFlight).toBe(2);
        expect(last.query).toBe(LAST_MONTH);
        expect(last.groups.Expenses.period).toBe('1200.5');
        expect(before.groups.Expenses.period).toBe('0');
        expect(again).toBe(last);
        expect(last.dataAt).toBe(NOW.toISOString());
    });

    it('caches each exact query for 60 seconds per user and Book', async () => {
        const kv = createTestEnv().KV;
        const puts: { key: string; ttl?: number }[] = [];
        const put = kv.put;
        kv.put = async (key, value, ttl?: { expirationTtl?: number }) => {
            puts.push({ key, ttl: ttl?.expirationTtl });
            return put(key, value);
        };
        const first = await loadBalances([LAST_MONTH], options({ kv }));
        const warm = options({ kv });
        const second = await loadBalances([LAST_MONTH, MONTH_BEFORE], warm);

        expect(BALANCES_TTL_SECONDS).toBe(60);
        expect(puts).toEqual([
            { key: await balancesKey('user-1', 'book-1', LAST_MONTH), ttl: 60 },
            { key: await balancesKey('user-1', 'book-1', MONTH_BEFORE), ttl: 60 },
        ]);
        // Only the query not read before goes to Bkper.
        expect(warm.reads).toEqual([MONTH_BEFORE]);
        expect(second[0]).toEqual(first[0]);
    });

    it('keys entries by user, Book and exact query, within the KV key limit', async () => {
        const key = await balancesKey('user-1', 'book-1', LAST_MONTH);
        expect(key).toMatch(/^balances:v2:user-1:book-1:[0-9a-f]{64}$/);
        expect(await balancesKey('user-2', 'book-1', LAST_MONTH)).not.toBe(key);
        expect(await balancesKey('user-1', 'book-2', LAST_MONTH)).not.toBe(key);
        expect(await balancesKey('user-1', 'book-1', `${LAST_MONTH} `)).not.toBe(key);
        const long = await balancesKey('user-1', 'book-1', `group:'${'x'.repeat(2000)}' by:m`);
        expect(new TextEncoder().encode(long).length).toBeLessThan(512);
    });

    it('does not share balances between users', async () => {
        const kv = createTestEnv().KV;
        await loadBalances([LAST_MONTH], options({ kv }));
        const other = options({ kv, userId: 'user-2' });
        await loadBalances([LAST_MONTH], other);
        expect(other.reads).toEqual([LAST_MONTH]);
    });

    it('stores in the background when it can, so the response does not wait', async () => {
        const kv = createTestEnv().KV;
        const deferred: Promise<unknown>[] = [];
        await loadBalances([LAST_MONTH], options({ kv, defer: task => deferred.push(task) }));
        expect(deferred).toHaveLength(1);
        await Promise.all(deferred);
        expect(await kv.get(await balancesKey('user-1', 'book-1', LAST_MONTH))).not.toBeNull();
    });

    it('reports kv and balances timings, and only kv when every query is cached', async () => {
        const cold = options();
        await loadBalances([LAST_MONTH], cold);
        expect(cold.timing.header()).toMatch(/^kv;dur=[\d.]+, balances;dur=[\d.]+$/);
        const warm = options({ kv: cold.kv });
        await loadBalances([LAST_MONTH], warm);
        expect(warm.timing.header()).toMatch(/^kv;dur=[\d.]+$/);
    });

    it('fails without caching when a query fails', async () => {
        const kv = createTestEnv().KV;
        const failing = options({
            kv,
            read: async () => {
                throw new Error('upstream');
            },
        });
        await expect(loadBalances([LAST_MONTH], failing)).rejects.toThrow('upstream');
        expect(await kv.get(await balancesKey('user-1', 'book-1', LAST_MONTH))).toBeNull();
    });
});
