import { describe, expect, test } from 'bun:test';
import { Summary, SummaryState } from '../../../src/api/services/summary.js';

describe('legacy Inventory Summary', () => {
    test('preserves Account identity, default result, done results, and JSON formatting', () => {
        const summary = new Summary('item-account');

        expect(summary.getAccountId()).toBe('item-account');
        expect(summary.getResult()).toBe('Nothing to calculate');
        expect(summary.getState()).toBe(SummaryState.EMPTY);
        expect(summary.done('Done explicitly').getResult()).toBe('Done explicitly');
        expect(summary.getState()).toBe(SummaryState.DONE);
        expect(summary.json().getResult()).toBe('"Done explicitly"');
        expect(summary.getState()).toBe(SummaryState.DONE);
    });

    test('preserves operation and error messages', () => {
        const rebuild = new Summary('item').rebuild();
        expect(rebuild.getState()).toBe(SummaryState.REBUILD);
        expect(rebuild.getResult()).toBe('Account needs rebuild: resetting...');

        const resetting = new Summary('item').resetingAsync();
        expect(resetting.getState()).toBe(SummaryState.RESETTING);
        expect(resetting.getResult()).toBe('Resetting...');

        const calculating = new Summary('item').calculatingAsync();
        expect(calculating.getState()).toBe(SummaryState.CALCULATING);
        expect(calculating.getResult()).toBe('Calculating...');

        const locked = new Summary('item').lockError();
        expect(locked.getState()).toBe(SummaryState.LOCKED);
        expect(locked.getResult()).toBe('Cannot proceed: collection has locked/closed book(s)');

        const saleError = new Summary('item').salequantityError();
        expect(saleError.getState()).toBe(SummaryState.SALE_QUANTITY_ERROR);
        expect(saleError.getResult()).toBe(
            'Cannot proceed: sales quantity is greater than quantity purchased'
        );

        const creditError = new Summary('item').creditNoteQuantityError('credit-1');
        expect(creditError.getState()).toBe(SummaryState.CREDIT_NOTE_QUANTITY_ERROR);
        expect(creditError.getResult()).toBe(
            'Cannot proceed: credit note quantity is greater than purchased quantity. Credit note: credit-1'
        );
    });
});
