const MAX_REQUEST_BATCH_SIZE = 5;

/**
 * Runs asynchronous requests in sequential fixed-size batches.
 *
 * The maximum applies per invocation. Concurrent invocations can collectively run more requests.
 *
 * @param items - The ordered items for which requests should run.
 * @param batchSize - The number of requests to run concurrently, from 1 through 5.
 * @param request - The asynchronous request to run for each item.
 * @returns A promise that resolves to request results in input order.
 * @throws {RangeError} When `batchSize` is not an integer from 1 through 5.
 */
export async function runRequestsInBatches<T, R>(
    items: Iterable<T>,
    batchSize: number,
    request: (item: T) => Promise<R>
): Promise<R[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_REQUEST_BATCH_SIZE) {
        throw new RangeError(
            `Batch size must be an integer from 1 through ${MAX_REQUEST_BATCH_SIZE}`
        );
    }

    const orderedItems = Array.from(items);
    const results: R[] = [];

    for (let i = 0; i < orderedItems.length; i += batchSize) {
        const batch = orderedItems.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(item => request(item)));
        results.push(...batchResults);
    }

    return results;
}
