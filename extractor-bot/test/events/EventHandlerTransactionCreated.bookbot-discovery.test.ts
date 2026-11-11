/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Book, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';
import type { DiscoveryBatchOutcome, DiscoveryItem } from '../../src/services/BookbotDiscoveryClient.js';

// Verifies that created transactions without attachments ask Bookbot for discovery and report failures distinctly.
describe('EventHandlerTransactionCreated - Bookbot discovery', () => {
    const mockBook = {
        getId: () => 'book_1',
        getConfig: () => ({}),
        getFractionDigits: () => 2,
        getDecimalSeparator: () => 'DOT',
    } as unknown as Book;
    let discover: ReturnType<typeof mock<(bookId: string, items: DiscoveryItem[]) => Promise<DiscoveryBatchOutcome>>>;
    let context: AppContext;
    let originalUpdate: typeof Transaction.prototype.update;

    const event = {
        bookId: 'book_1',
        data: {
            object: {
                transaction: {
                    id: 'tx_1',
                    date: '2026-10-30',
                    amount: '1500',
                    description: 'Monthly rent',
                    createdBy: 'someone',
                    properties: {},
                    creditAccount: { id: 'bank', name: 'Bank Account' },
                },
            },
        },
    } as bkper.Event;

    beforeEach(() => {
        discover = mock(async (_bookId: string, items: DiscoveryItem[]) => ({ outcomes: items.map(() => 'no_match' as const) }));
        context = { createBookbotDiscoveryClient: () => ({ discover }) } as unknown as AppContext;
        originalUpdate = Transaction.prototype.update;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            return this;
        }) as typeof Transaction.prototype.update;
    });

    afterEach(() => {
        Transaction.prototype.update = originalUpdate;
    });

    it('updates the transaction once with the Accounts Bookbot discovered', async () => {
        discover.mockImplementation(async (_bookId: string, items: DiscoveryItem[]) => {
            items[0].transaction.payload.debitAccount = { id: 'rent' };
            return { outcomes: ['changed' as const] };
        });

        const result = await new EventHandlerTransactionCreated(context).handleEvent(mockBook, event);

        const [bookId, items] = discover.mock.calls[0];
        expect(bookId).toBe('book_1');
        expect(items).toHaveLength(1);
        expect(items[0].transaction.getId()).toBe('tx_1');
        expect(items[0].sourceAccount).toBeUndefined();
        expect(Transaction.prototype.update).toHaveBeenCalledTimes(1);
        expect(result.result.transaction.debitAccount).toEqual({ id: 'rent' });
        expect(result.warning).toBeUndefined();
    });

    it('does not update or respond when Bookbot finds no match', async () => {
        const result = await new EventHandlerTransactionCreated(context).handleEvent(mockBook, event);

        expect(Transaction.prototype.update).not.toHaveBeenCalled();
        expect(result).toEqual({ result: false });
    });

    it('reports a discovery failure without updating the transaction', async () => {
        discover.mockImplementation(async () => ({ outcomes: ['error' as const], error: { code: 'HTTP_503', message: 'Bookbot discovery request failed.' } }));

        const result = await new EventHandlerTransactionCreated(context).handleEvent(mockBook, event);

        expect(Transaction.prototype.update).not.toHaveBeenCalled();
        expect(result).toEqual({ warning: 'Account discovery failed (HTTP_503); the transaction was left without discovered Accounts.' });
    });
});
