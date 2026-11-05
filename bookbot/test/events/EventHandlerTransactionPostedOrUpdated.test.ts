/// <reference types="@bkper/bkper-api-types" />

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Book } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionPostedOrUpdated } from '../../src/events/EventHandlerTransactionPostedOrUpdated.js';

// Characterizes which jobs run when a transaction is posted or updated.
describe('EventHandlerTransactionPostedOrUpdated', () => {
    const book = { getId: () => 'book_1' } as unknown as Book;
    let rediscover: ReturnType<typeof mock>;
    let context: AppContext;

    function event(posted: boolean): bkper.Event {
        return {
            bookId: 'book_1',
            data: { object: { transaction: { id: 'tx_1', posted, description: 'Monthly rent' } } },
        } as bkper.Event;
    }

    beforeEach(() => {
        rediscover = mock(async () => 'Rediscovered 1 draft');
        context = {
            createRediscoveryService: () => ({ rediscover }),
        } as unknown as AppContext;
    });

    it('ignores transactions that are not posted', async () => {
        const result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event(false));

        expect(result).toEqual({ result: false });
        expect(rediscover).not.toHaveBeenCalled();
    });

    it('runs only rediscovery for posted transactions; extraction learning belongs to Parser Bot', async () => {
        const result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event(true));

        expect(rediscover).toHaveBeenCalledTimes(1);
        expect(result.result).toBe('Rediscovered 1 draft');
    });

    it('suppresses the response when rediscovery changes nothing', async () => {
        rediscover.mockImplementation(async () => null);

        const result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event(true));

        expect(result).toEqual({ result: false });
    });
});
