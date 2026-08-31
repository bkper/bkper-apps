const REQUEST_CONCURRENCY = 5;

type FulfilledRequestResult<T, R> = {
    item: T;
    status: 'fulfilled';
    value: R;
};

type RejectedRequestResult<T> = {
    item: T;
    status: 'rejected';
    reason: unknown;
};

type ConcurrentRequestResult<T, R> = FulfilledRequestResult<T, R> | RejectedRequestResult<T>;

/**
 * Runs asynchronous requests with bounded sliding concurrency.
 *
 * Each settled request releases capacity for the next ordered item. A request
 * rejection is retained against its item and does not block remaining items.
 * Concurrent invocations can collectively run more requests.
 *
 * @param items - The ordered items for which requests should run.
 * @param request - The asynchronous request to run for each item.
 * @returns A promise that resolves to ordered outcomes associated with their items.
 */
export async function runRequestsWithConcurrency<T, R>(
    items: Iterable<T>,
    request: (item: T) => Promise<R>
): Promise<ConcurrentRequestResult<T, R>[]> {
    const orderedItems = Array.from(items);
    const outcomes = new Array<ConcurrentRequestResult<T, R>>(orderedItems.length);

    const workerCount = Math.min(REQUEST_CONCURRENCY, orderedItems.length);
    let nextIndex = 0;

    const runWorker = async (): Promise<void> => {
        while (nextIndex < orderedItems.length) {
            const index = nextIndex++;
            outcomes[index] = await executeRequest(orderedItems[index], request);
        }
    };

    const workers = Array.from({ length: workerCount }, () => runWorker());
    await Promise.all(workers);

    return outcomes;
}

async function executeRequest<T, R>(
    item: T,
    request: (item: T) => Promise<R>
): Promise<ConcurrentRequestResult<T, R>> {
    try {
        return { item, status: 'fulfilled', value: await request(item) };
    } catch (reason: unknown) {
        return { item, status: 'rejected', reason };
    }
}
