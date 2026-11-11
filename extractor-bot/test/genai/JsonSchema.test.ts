import { describe, expect, it } from 'bun:test';

import {
    CLASSIFICATION_SCHEMA,
    CURATION_SCHEMA,
    EXTRACTED_STATEMENT_SCHEMA,
    EXTRACTED_TRANSACTION_SCHEMA,
    FILE_PROPERTIES_SCHEMA,
    REFLECTION_SCHEMA,
    validateStructuredValue,
} from '../../src/genai/JsonSchema.js';

describe('provider-neutral structured generation schemas', () => {
    it('validates invoice dates, nullability, required fields, and dynamic properties', () => {
        expect(validateStructuredValue(EXTRACTED_TRANSACTION_SCHEMA, {
            date: '2026-07-20', description: 'Office supplies', amount: 42.5,
            properties: { invoice: 'INV-1', confidence: 1 },
        })).toBe(true);
        expect(validateStructuredValue(EXTRACTED_TRANSACTION_SCHEMA, {
            date: null, description: 'Office supplies', amount: 42.5, properties: {},
        })).toBe(true);
        expect(validateStructuredValue(EXTRACTED_TRANSACTION_SCHEMA, {
            date: '20/07/2026', description: 'Office supplies', amount: 42.5, properties: {},
        })).toBe(false);
        expect(validateStructuredValue(EXTRACTED_TRANSACTION_SCHEMA, {
            date: null, description: 'Office supplies', amount: 42.5,
            properties: { invalid: true },
        })).toBe(false);
        expect(validateStructuredValue(EXTRACTED_TRANSACTION_SCHEMA, {
            date: null, description: 'Office supplies', properties: {},
        })).toBe(false);
    });

    it('validates statement transaction arrays and file-property maps', () => {
        expect(validateStructuredValue(EXTRACTED_STATEMENT_SCHEMA, {
            transactions: [{ date: null, description: 'Payment', amount: -10, properties: {} }],
        })).toBe(true);
        expect(validateStructuredValue(EXTRACTED_STATEMENT_SCHEMA, { transactions: ['bad'] })).toBe(false);
        expect(validateStructuredValue(FILE_PROPERTIES_SCHEMA, {
            properties: { issuer: 'Bank', page_count: 3 },
        })).toBe(true);
        expect(validateStructuredValue(FILE_PROPERTIES_SCHEMA, {
            properties: { nested: { value: 'bad' } },
        })).toBe(false);
    });

    it('validates classification and ACE reflection/curation contracts', () => {
        expect(validateStructuredValue(CLASSIFICATION_SCHEMA, { kind: 'statement' })).toBe(true);
        expect(validateStructuredValue(CLASSIFICATION_SCHEMA, { kind: 'unknown' })).toBe(false);
        expect(validateStructuredValue(REFLECTION_SCHEMA, {
            whatWorked: ['date'], whatFailed: ['amount'], suggestedImprovements: 'Use total.',
        })).toBe(true);
        expect(validateStructuredValue(REFLECTION_SCHEMA, {
            whatWorked: ['date'], whatFailed: ['amount'],
        })).toBe(false);
        expect(validateStructuredValue(CURATION_SCHEMA, { bullets: ['Use the total row.'] })).toBe(true);
        expect(validateStructuredValue(CURATION_SCHEMA, { bullets: [1] })).toBe(false);
    });
});
