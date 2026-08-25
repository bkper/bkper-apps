import { describe, expect, test } from 'bun:test';
import { Summary } from '../../../src/api/services/summary.js';

describe('legacy operation Summary', () => {
    test('preserves the legacy operation results', () => {
        expect(new Summary('account').getResult()).toBe('{}');
        expect(new Summary('account').done().getResult()).toBe('"Done! {}"');
        expect(new Summary('account').done('Complete').getResult()).toBe('"Complete"');
        expect(new Summary('account').rebuild().getResult()).toBe(
            '"Account needs rebuild: reseting async..."'
        );
        expect(new Summary('account').resetingAsync().getResult()).toBe('"Reseting async..."');
        expect(new Summary('account').calculatingAsync().getResult()).toBe(
            '"Calculating async..."'
        );
        expect(new Summary('account').lockError().getResult()).toBe(
            '"Cannot proceed: collection has locked/closed book(s)"'
        );
        expect(new Summary('account').forwardError('Forward failed').getResult()).toBe(
            '"Forward failed"'
        );
        expect(new Summary('account').done('Complete').json().getResult()).toBe('"\\"Complete\\""');
    });
});
