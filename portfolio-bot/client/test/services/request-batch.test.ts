import { describe, expect, it } from 'bun:test';
import { runRequestsWithConcurrency } from '../../src/services/request-batch.js';

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}

function createDeferred(): Deferred {
    let resolve = (): void => {};
    const promise = new Promise<void>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('request concurrency', () => {
    it('starts the next request when one of five active requests settles', async () => {
        const items = Array.from({ length: 7 }, (_, index) => index + 1);
        const gates = items.map(() => createDeferred());
        const startedSignals = items.map(() => createDeferred());
        const started: number[] = [];
        let active = 0;
        let maximumActive = 0;

        const resultsPromise = runRequestsWithConcurrency(items, async item => {
            started.push(item);
            active++;
            maximumActive = Math.max(maximumActive, active);
            startedSignals[item - 1].resolve();
            await gates[item - 1].promise;
            active--;
            return item * 10;
        });

        await Promise.all(startedSignals.slice(0, 5).map(signal => signal.promise));
        expect(started).toEqual([1, 2, 3, 4, 5]);

        gates[2].resolve();
        await startedSignals[5].promise;
        expect(started).toEqual([1, 2, 3, 4, 5, 6]);

        gates[5].resolve();
        await startedSignals[6].promise;
        expect(started).toEqual(items);
        expect(maximumActive).toBe(5);

        for (const gate of gates) {
            gate.resolve();
        }

        expect(await resultsPromise).toEqual(
            items.map(item => ({ item, status: 'fulfilled', value: item * 10 }))
        );
    });

    it('records a request error against its item and continues processing', async () => {
        const requestError = new Error('Request failed');
        const items = [1, 2, 3, 4, 5, 6];
        const started: number[] = [];

        const results = await runRequestsWithConcurrency(items, async item => {
            started.push(item);
            if (item === 2) {
                throw requestError;
            }
            return item * 10;
        });

        expect(started).toEqual(items);
        expect(results).toEqual([
            { item: 1, status: 'fulfilled', value: 10 },
            { item: 2, status: 'rejected', reason: requestError },
            { item: 3, status: 'fulfilled', value: 30 },
            { item: 4, status: 'fulfilled', value: 40 },
            { item: 5, status: 'fulfilled', value: 50 },
            { item: 6, status: 'fulfilled', value: 60 },
        ]);
    });
});
