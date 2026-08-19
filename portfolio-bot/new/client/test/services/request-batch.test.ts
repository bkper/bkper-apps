import { describe, expect, it } from 'bun:test';
import { runRequestsInBatches } from '../../src/services/request-batch.js';

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

describe('request batching', () => {
    it('runs batches of five sequentially and preserves input order', async () => {
        const batchGates = [createDeferred(), createDeferred(), createDeferred()];
        const batchStarted = [createDeferred(), createDeferred(), createDeferred()];
        const items = Array.from({ length: 11 }, (_, index) => index + 1);
        const started: number[] = [];

        const resultsPromise = runRequestsInBatches(items, async item => {
            started.push(item);
            const batchIndex = Math.floor((item - 1) / 5);
            batchStarted[batchIndex].resolve();
            await batchGates[batchIndex].promise;
            return item * 10;
        });

        await batchStarted[0].promise;
        expect(started).toEqual([1, 2, 3, 4, 5]);

        batchGates[0].resolve();
        await batchStarted[1].promise;
        expect(started).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        batchGates[1].resolve();
        await batchStarted[2].promise;
        expect(started).toEqual(items);

        batchGates[2].resolve();
        expect(await resultsPromise).toEqual(items.map(item => item * 10));
    });

    it('rejects a failed batch without starting later requests', async () => {
        const requestError = new Error('Request failed');
        const started: number[] = [];

        const resultsPromise = runRequestsInBatches([1, 2, 3, 4, 5, 6], async item => {
            started.push(item);
            if (item === 2) {
                throw requestError;
            }
            return item;
        });

        await expect(resultsPromise).rejects.toBe(requestError);
        expect(started).toEqual([1, 2, 3, 4, 5]);
    });
});
