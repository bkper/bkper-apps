/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Book } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionPostedOrUpdated } from '../../src/events/EventHandlerTransactionPostedOrUpdated.js';
import { InvoicePromptImprovementService } from '../../src/services/InvoicePromptImprovementService.js';
import { StatementPromptImprovementService } from '../../src/services/StatementPromptImprovementService.js';

// Characterizes which jobs run when a transaction is posted or updated.
describe('EventHandlerTransactionPostedOrUpdated', () => {
    const book = { getId: () => 'book_1' } as unknown as Book;
    let rediscover: ReturnType<typeof mock>;
    let context: AppContext;
    let invoiceLearning: ReturnType<typeof spyOn>;
    let statementFlagging: ReturnType<typeof spyOn>;

    function event(posted: boolean): bkper.Event {
        return {
            bookId: 'book_1',
            data: { object: { transaction: { id: 'tx_1', posted, description: 'Monthly rent' } } },
        } as bkper.Event;
    }

    beforeEach(() => {
        rediscover = mock(async () => 'Rediscovered 1 draft');
        context = {
            jevEvaluationService: {},
            createRediscoveryService: () => ({ rediscover }),
        } as unknown as AppContext;
        invoiceLearning = spyOn(InvoicePromptImprovementService.prototype, 'improveInvoicePrompt').mockImplementation(async () => 'Invoice prompt improved');
        statementFlagging = spyOn(StatementPromptImprovementService.prototype, 'flagStatementForImprovement').mockImplementation(async () => 'Statement flagged');
    });

    afterEach(() => {
        invoiceLearning.mockRestore();
        statementFlagging.mockRestore();
    });

    it('ignores transactions that are not posted', async () => {
        const result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event(false));

        expect(result).toEqual({ result: false });
        expect(invoiceLearning).not.toHaveBeenCalled();
        expect(statementFlagging).not.toHaveBeenCalled();
        expect(rediscover).not.toHaveBeenCalled();
    });

    it('runs only rediscovery for posted transactions; extraction learning belongs to Parser Bot', async () => {
        const result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event(true));

        expect(invoiceLearning).not.toHaveBeenCalled();
        expect(statementFlagging).not.toHaveBeenCalled();
        expect(rediscover).toHaveBeenCalledTimes(1);
        expect(result.result).toBe('Rediscovered 1 draft');
    });

    it('suppresses the response when rediscovery changes nothing', async () => {
        rediscover.mockImplementation(async () => null);

        const result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event(true));

        expect(result).toEqual({ result: false });
    });
});
