import { describe, expect, test } from 'bun:test';
import { CalculationModel } from '../../../../src/api/services/calculate/types.js';

describe('legacy Calculate model', () => {
    test('preserves the Portfolio Book model values', () => {
        expect(String(CalculationModel.HISTORICAL_ONLY)).toBe('historical');
        expect(String(CalculationModel.FAIR_ONLY)).toBe('fair');
        expect(String(CalculationModel.BOTH)).toBe('both');
    });
});
