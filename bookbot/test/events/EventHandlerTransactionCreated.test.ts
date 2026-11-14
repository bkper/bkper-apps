/// <reference types="@bkper/bkper-api-types" />

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Bkper, Book, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { AUTO_FILLED_DATE_PROPERTY, EXTRACTOR_FILE_ID_PROPERTY, LEGACY_AGENT_FILE_ID_PROPERTY } from '../../src/constants.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';
import type { ExtractorAmount } from '../../src/genai/ExtractorAmount.js';
import type { ExtractorDate } from '../../src/genai/ExtractorDate.js';
import { Discovery } from '../../src/services/DiscoveryService.js';
import { FixedAmountExtractor, FixedDateExtractor } from '../helpers/descriptionExtractors.js';

/** Fills the debit side, or nothing, and records the amount it saw. */
class TestDiscovery extends Discovery {
    readonly amountsSeen: (string | undefined)[] = [];

    constructor(context: AppContext, private readonly debitAccountId?: string) {
        super(context);
    }

    override async discover(draft: Transaction): Promise<{ discovered: boolean }> {
        this.amountsSeen.push(draft.payload.amount);
        if (!this.debitAccountId) return { discovered: false };
        draft.payload.debitAccount = { id: this.debitAccountId };
        return { discovered: true };
    }
}

class TestContext extends AppContext {
    amount = new FixedAmountExtractor();
    date = new FixedDateExtractor();
    discovery = new TestDiscovery(this);

    constructor() {
        super(new Bkper(), { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' });
    }

    override createExtractorAmount(): ExtractorAmount {
        return this.amount;
    }

    override createExtractorDate(): ExtractorDate {
        return this.date;
    }

    override createDiscovery(): Discovery {
        return this.discovery;
    }
}

const book = new Book({ id: 'synthetic-book' });

function created(transaction: bkper.Transaction): bkper.Event {
    return {
        bookId: 'synthetic-book',
        type: 'TRANSACTION_CREATED',
        data: { object: { transaction: { id: 'tx_1', description: 'HOME MTG', date: '2026-11-14', ...transaction } } },
    } as bkper.Event;
}

afterEach(() => mock.restore());

describe('EventHandlerTransactionCreated', () => {
    it('completes a typed draft, then discovers with the completed amount, and updates it once', async () => {
        const update = spyOn(Transaction.prototype, 'update').mockImplementation(async function (this: Transaction) { return this; });
        const context = new TestContext();
        context.amount = new FixedAmountExtractor('25');
        context.date = new FixedDateExtractor('2026-11-12');
        context.discovery = new TestDiscovery(context, 'expense');

        const result = await new EventHandlerTransactionCreated(context).handleEvent(book, created({
            description: 'Lunch 25 on 12/11', properties: { [AUTO_FILLED_DATE_PROPERTY]: 'true' },
        }));

        expect(update).toHaveBeenCalledTimes(1);
        expect(context.discovery.amountsSeen).toEqual(['25']);
        expect(result.result).toEqual({ transaction: expect.objectContaining({
            amount: '25', date: '2026-11-12', debitAccount: { id: 'expense' },
        }) });
    });

    it('updates when only discovery fills the draft, asking no model for a supplied amount or chosen date', async () => {
        const update = spyOn(Transaction.prototype, 'update').mockImplementation(async function (this: Transaction) { return this; });
        const context = new TestContext();
        context.discovery = new TestDiscovery(context, 'expense');

        const result = await new EventHandlerTransactionCreated(context).handleEvent(book, created({ amount: '88.00' }));

        expect(update).toHaveBeenCalledTimes(1);
        expect(context.amount.descriptions).toEqual([]);
        expect(context.date.descriptions).toEqual([]);
        expect(result.result).toEqual({ transaction: expect.objectContaining({ amount: '88.00', debitAccount: { id: 'expense' } }) });
    });

    it('stays silent and writes nothing when nothing was filled', async () => {
        const update = spyOn(Transaction.prototype, 'update');
        const context = new TestContext();

        const result = await new EventHandlerTransactionCreated(context).handleEvent(book, created({ amount: '88.00' }));

        expect(result).toEqual({ result: false });
        expect(update).not.toHaveBeenCalled();
    });

    it('leaves drafts with files to Extractor Bot, and drafts recorded from a file to the app that recorded them', async () => {
        const update = spyOn(Transaction.prototype, 'update');
        const context = new TestContext();
        context.amount = new FixedAmountExtractor('25');
        context.discovery = new TestDiscovery(context, 'expense');
        const drafts: bkper.Transaction[] = [
            { files: [{ id: 'file_1' }] },
            { properties: { [EXTRACTOR_FILE_ID_PROPERTY]: 'file_1' } },
            { properties: { [LEGACY_AGENT_FILE_ID_PROPERTY]: 'file_1' } },
        ];

        for (const draft of drafts) {
            expect(await new EventHandlerTransactionCreated(context).handleEvent(book, created(draft))).toEqual({ result: false });
        }
        expect(update).not.toHaveBeenCalled();
        expect(context.amount.descriptions).toEqual([]);
        expect(context.discovery.amountsSeen).toEqual([]);
    });
});
