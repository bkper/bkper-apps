const REQUEST_BATCH_SIZE = 5;

/**
 * Runs asynchronous requests in sequential batches.
 *
 * Concurrent invocations can collectively run more requests.
 *
 * @param items - The ordered items for which requests should run.
 * @param request - The asynchronous request to run for each item.
 * @returns A promise that resolves to request results in input order.
 */
export async function runRequestsInBatches<T, R>(
    items: Iterable<T>,
    request: (item: T) => Promise<R>
): Promise<R[]> {
    const orderedItems = Array.from(items);
    const results: R[] = [];

    for (let i = 0; i < orderedItems.length; i += REQUEST_BATCH_SIZE) {
        const batch = orderedItems.slice(i, i + REQUEST_BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(item => request(item)));
        results.push(...batchResults);
    }

    return results;
}
