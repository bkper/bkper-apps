import { Account, Transaction } from 'bkper-js';
import type { components } from '../clients/bookbot/types.js';

/**
 * Every Extractor Bot environment calls only production Bookbot. Production Bookbot has handled all Bookbot events
 * since the 2026-11-03 cutover; the legacy Worker stays only as a rollback target and is never called.
 */
export const BOOKBOT_API_BASE_URL = 'https://bookbot.bkper.app';

type DiscoveryBatch = components['schemas']['DiscoveryBatch'];
type DiscoveryResult = components['schemas']['DiscoveryResult'];
export type DiscoveryOutcome = DiscoveryResult['outcome'];
export type DiscoveryError = { code: string; message: string };

export interface DiscoveryItem {
    transaction: Transaction;
    sourceAccount?: Account;
}

export interface DiscoveryBatchOutcome {
    /** One outcome per item, in item order. */
    outcomes: DiscoveryOutcome[];
    /** The first failure, when any item could not be discovered. */
    error?: DiscoveryError;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Asks Bookbot to discover Accounts and properties for drafts of one target Book, then applies its suggestions locally.
 * Platform outbound supplies authorization; this client never reads or sends credentials. It never writes to Books.
 */
export class BookbotDiscoveryClient {
    constructor(
        private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
        private readonly baseUrl: string = BOOKBOT_API_BASE_URL,
        private readonly signal?: AbortSignal,
    ) {}

    async discover(bookId: string, items: DiscoveryItem[]): Promise<DiscoveryBatchOutcome> {
        if (items.length === 0) {
            return { outcomes: [] };
        }

        const request: DiscoveryBatch = {
            items: items.map((item, index) => {
                const sourceAccountId = item.sourceAccount?.getId();
                return {
                    itemId: String(index),
                    bookId,
                    transaction: requestTransaction(item.transaction),
                    ...(sourceAccountId ? { sourceAccount: { id: sourceAccountId } } : {}),
                };
            }),
        };

        let results: unknown;
        try {
            const response = await this.fetcher(`${this.baseUrl}/api/v1/discovery/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
                signal: this.signal,
            });
            if (!response.ok) {
                return failAll(items, { code: `HTTP_${response.status}`, message: 'Bookbot discovery request failed.' });
            }
            results = ((await response.json()) as { items?: unknown }).items;
        } catch (error) {
            // A cancelled event is not a discovery outage.
            this.signal?.throwIfAborted();
            console.warn('Bookbot discovery is unavailable:', error instanceof Error ? error.message : error);
            return failAll(items, { code: 'UNAVAILABLE', message: 'Bookbot discovery is unavailable.' });
        }

        if (!Array.isArray(results)) {
            return failAll(items, { code: 'INVALID_RESPONSE', message: 'Bookbot discovery returned an invalid response.' });
        }

        const outcomes: DiscoveryOutcome[] = [];
        let firstError: DiscoveryError | undefined;
        for (const [index, item] of items.entries()) {
            const result = (results as DiscoveryResult[]).find(candidate => candidate?.itemId === String(index));
            if (!result || !result.transaction) {
                outcomes.push('error');
                firstError ??= { code: 'INVALID_RESPONSE', message: 'Bookbot discovery returned no result for an item.' };
                continue;
            }
            if (result.outcome === 'error') {
                outcomes.push('error');
                firstError ??= result.error ?? { code: 'DISCOVERY_ERROR', message: 'Bookbot discovery failed for an item.' };
                continue;
            }
            applyDiscovery(item.transaction, result.transaction);
            outcomes.push(result.outcome);
        }

        return { outcomes, ...(firstError ? { error: firstError } : {}) };
    }
}

/** Discovery reads description, Account sides, properties, tags, ID and creator; attached files are not needed. */
function requestTransaction(transaction: Transaction): bkper.Transaction {
    const payload = transaction.json();
    delete payload.files;
    return payload;
}

/** Discovery only fills Account sides and properties; every other local field stays as extracted. */
function applyDiscovery(transaction: Transaction, discovered: bkper.Transaction): void {
    if (discovered.creditAccount) {
        transaction.payload.creditAccount = discovered.creditAccount;
    }
    if (discovered.debitAccount) {
        transaction.payload.debitAccount = discovered.debitAccount;
    }
    transaction.payload.properties = { ...(discovered.properties ?? {}) };
}

function failAll(items: DiscoveryItem[], error: DiscoveryError): DiscoveryBatchOutcome {
    return { outcomes: items.map(() => 'error' as const), error };
}
