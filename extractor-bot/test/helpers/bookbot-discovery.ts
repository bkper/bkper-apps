import { mock } from 'bun:test';
import type { DiscoveryBatchOutcome, DiscoveryItem } from '../../src/services/BookbotDiscoveryClient.js';

/** Test double for Bookbot's discovery API that finds no Accounts for any item. */
export function createNoMatchBookbotDiscoveryClient() {
    return {
        discover: mock(async (_bookId: string, items: DiscoveryItem[]): Promise<DiscoveryBatchOutcome> => ({
            outcomes: items.map(() => 'no_match' as const),
        })),
    };
}
