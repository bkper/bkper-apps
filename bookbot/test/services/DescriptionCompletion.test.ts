import { describe, expect, it } from 'bun:test';
import { Bkper, Book, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { AUTO_FILLED_DATE_PROPERTY } from '../../src/constants.js';
import type { ExtractorAmount } from '../../src/genai/ExtractorAmount.js';
import type { ExtractorDate } from '../../src/genai/ExtractorDate.js';
import { FixedAmountExtractor, FixedDateExtractor } from '../helpers/descriptionExtractors.js';

class TestContext extends AppContext {
    amount = new FixedAmountExtractor('25');
    date = new FixedDateExtractor('2026-11-12');
    amountError?: Error;

    constructor() {
        super(new Bkper(), { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' });
    }

    override createExtractorAmount(onError?: (error: unknown) => void): ExtractorAmount {
        return this.amountError ? new FixedAmountExtractor('25', onError, this.amountError) : this.amount;
    }

    override createExtractorDate(): ExtractorDate {
        return this.date;
    }
}

const book = new Book({ id: 'synthetic-book' });

function draft(payload: bkper.Transaction): Transaction {
    return new Transaction(book, { description: 'Lunch 25 on 12/11', date: '2026-11-14', ...payload });
}

describe('completing a draft from its description', () => {
    it('fills a missing amount and an automatically filled date', async () => {
        const context = new TestContext();
        const transaction = draft({ properties: { [AUTO_FILLED_DATE_PROPERTY]: 'true' } });

        expect(await context.createDescriptionCompletion().complete(transaction)).toBe(true);
        expect(transaction.payload.amount).toBe('25');
        expect(transaction.payload.date).toBe('2026-11-12');
    });

    it('never replaces a supplied amount or a date the user chose, and asks no model for them', async () => {
        const context = new TestContext();
        const transaction = draft({ amount: '88.00' });

        expect(await context.createDescriptionCompletion().complete(transaction)).toBe(false);
        expect(transaction.payload.amount).toBe('88.00');
        expect(transaction.payload.date).toBe('2026-11-14');
        expect(context.amount.descriptions).toEqual([]);
        expect(context.date.descriptions).toEqual([]);
    });

    it('treats an empty amount as missing and leaves the draft unchanged when the description states nothing', async () => {
        const context = new TestContext();
        context.amount = new FixedAmountExtractor();
        context.date = new FixedDateExtractor();
        const transaction = draft({ amount: '', properties: { [AUTO_FILLED_DATE_PROPERTY]: 'true' } });

        expect(await context.createDescriptionCompletion().complete(transaction)).toBe(false);
        expect(transaction.payload.amount).toBe('');
        expect(transaction.payload.date).toBe('2026-11-14');
        expect(context.amount.descriptions).toEqual(['Lunch 25 on 12/11']);
        expect(context.date.descriptions).toEqual(['Lunch 25 on 12/11']);
    });

    it('ignores a zero or negative amount read from the description', async () => {
        const context = new TestContext();
        context.amount = new FixedAmountExtractor('-5');
        const transaction = draft({});

        expect(await context.createDescriptionCompletion().complete(transaction)).toBe(false);
        expect(transaction.payload.amount).toBeUndefined();
    });

    it('swallows a model failure for events and reports it to API callers', async () => {
        const context = new TestContext();
        context.amountError = new Error('Synthetic inference failure');

        expect(await context.createDescriptionCompletion().complete(draft({}))).toBe(false);
        await expect(context.createDescriptionCompletion(error => { throw error; }).complete(draft({}))).rejects.toThrow('Synthetic inference failure');
    });
});
