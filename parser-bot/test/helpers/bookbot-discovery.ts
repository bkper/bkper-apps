import { mock } from 'bun:test';
import type { AppContext } from '../../src/AppContext.js';
import type { DiscoveryBatchOutcome, DiscoveryItem, DiscoveryOutcome } from '../../src/services/BookbotDiscoveryClient.js';
import { Discovery } from '../../src/services/DiscoveryService.js';

/**
 * Test double for Bookbot's discovery API. It runs the same Discovery code that Bookbot runs behind
 * /api/v1/discovery/batch (account discovery, then property discovery when a source Account is given), in-process.
 */
export function createLocalBookbotDiscoveryClient(context: AppContext) {
    return {
        discover: mock(async (_bookId: string, items: DiscoveryItem[]): Promise<DiscoveryBatchOutcome> => {
            const discovery = new Discovery(context);
            const outcomes: DiscoveryOutcome[] = [];
            for (const { transaction, sourceAccount } of items) {
                const result = await discovery.discover(transaction);
                if (sourceAccount && result.dataSet) {
                    await discovery.discoverProperties(sourceAccount, transaction, result.dataSet);
                }
                outcomes.push(result.discovered ? 'changed' : 'no_match');
            }
            return { outcomes };
        }),
    };
}

/** Test double for Bookbot's discovery API that finds no Accounts for any item. */
export function createNoMatchBookbotDiscoveryClient() {
    return {
        discover: mock(async (_bookId: string, items: DiscoveryItem[]): Promise<DiscoveryBatchOutcome> => ({
            outcomes: items.map(() => 'no_match' as const),
        })),
    };
}
