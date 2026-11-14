/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Book, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';

// Typed transactions belong to Bookbot, which completes them when they are created.
describe('EventHandlerTransactionCreated - typed transactions', () => {
    const book = { getId: () => 'book_1', getConfig: () => ({}) } as unknown as Book;
    let calls: string[];
    let context: AppContext;
    let originalUpdate: typeof Transaction.prototype.update;

    beforeEach(() => {
        calls = [];
        const record = (name: string) => () => { calls.push(name); throw new Error(`${name} must not be used`); };
        context = {
            createBookbotDiscoveryClient: record('discovery'),
            promptLookupService: { lookupPrompts: record('prompts'), lookupParserUrl: record('parser URL') },
        } as unknown as AppContext;
        originalUpdate = Transaction.prototype.update;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            return this;
        }) as typeof Transaction.prototype.update;
    });

    afterEach(() => {
        Transaction.prototype.update = originalUpdate;
    });

    it('leaves a transaction without files to Bookbot: no discovery, extraction, lookup or update', async () => {
        const event = {
            bookId: 'book_1',
            data: { object: { transaction: { id: 'tx_1', date: '2026-11-14', description: 'HOME MTG', properties: { auto_filled_date_: 'true' } } } },
        } as bkper.Event;

        const result = await new EventHandlerTransactionCreated(context).handleEvent(book, event);

        expect(result).toEqual({ result: false });
        expect(calls).toEqual([]);
        expect(Transaction.prototype.update).not.toHaveBeenCalled();
    });
});
