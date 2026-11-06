import { describe, expect, it } from 'vitest';
import { isolate, withoutIsolates } from '../src/bidi';

describe('isolate', () => {
    it('isolates a value inserted into text, whatever its direction', () => {
        expect(isolate('Studio Norte')).toBe('\u2068Studio Norte\u2069');
    });

    it('leaves out the isolates of a text where only its letters count', () => {
        expect(withoutIsolates(`في ${isolate('٥ نوفمبر ٢٠٢٦')}`)).toBe('في ٥ نوفمبر ٢٠٢٦');
    });
});
