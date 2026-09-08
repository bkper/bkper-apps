import { describe, expect, test } from 'bun:test';
import { Summary } from '../../../src/api/services/summary.js';

describe('legacy Inventory Summary', () => {
    test('preserves Account identity, default result, fluent results, and JSON formatting', () => {
        const summary = new Summary('item-account');

        expect(summary.getAccountId()).toBe('item-account');
        expect(summary.getResult()).toBe('Nothing to calculate');
        expect(summary.hasError()).toBe(false);
        expect(summary.setResult('Custom').getResult()).toBe('Custom');
        expect(summary.done('Done explicitly').getResult()).toBe('Done explicitly');
        expect(summary.setResult('Result').done().getResult()).toBe('Done! "Result"');
        expect(summary.json().getResult()).toBe('"Done! \\"Result\\""');
    });

    test('preserves operation and error messages', () => {
        expect(new Summary('item').rebuild().getResult()).toBe(
            'Account needs rebuild: reseting...'
        );
        expect(new Summary('item').resetingAsync().getResult()).toBe('Reseted');
        expect(new Summary('item').calculatingAsync().getResult()).toBe('Calculated');

        const locked = new Summary('item').lockError();
        expect(locked.hasError()).toBe(true);
        expect(locked.getResult()).toBe('Cannot proceed: collection has locked/closed book(s)');

        const saleError = new Summary('item').salequantityError();
        expect(saleError.hasError()).toBe(true);
        expect(saleError.getResult()).toBe(
            'Cannot proceed: sales quantity is greater than quantity purchased'
        );

        const creditError = new Summary('item').creditNoteQuantityError('credit-1');
        expect(creditError.hasError()).toBe(true);
        expect(creditError.getResult()).toBe(
            'Cannot proceed: credit note quantity is greater than purchased quantity. Credit note: credit-1'
        );
    });
});
