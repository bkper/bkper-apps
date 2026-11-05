import { describe, expect, it } from 'bun:test';

import { DESCRIPTION_PARTS_SCHEMA, validateStructuredValue } from '../../src/genai/JsonSchema.js';

describe('provider-neutral structured generation schemas', () => {
    it('validates description parts as an array of strings', () => {
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, ['Office Depot'])).toBe(true);
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, ['Product Alpha', 'Product Beta'])).toBe(true);
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, [])).toBe(true);
    });

    it('rejects values that do not match the description parts schema', () => {
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, 'Office Depot')).toBe(false);
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, [42])).toBe(false);
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, null)).toBe(false);
        expect(validateStructuredValue(DESCRIPTION_PARTS_SCHEMA, { parts: ['Office Depot'] })).toBe(false);
    });
});
