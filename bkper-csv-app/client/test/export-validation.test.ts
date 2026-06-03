import { describe, expect, it } from 'bun:test';
import { getExportValidationMessage, QUERY_REQUIRED_MESSAGE } from '../src/export-validation';

describe('export validation', () => {
    it('requires a query before exporting', () => {
        expect(getExportValidationMessage('')).toBe(QUERY_REQUIRED_MESSAGE);
        expect(getExportValidationMessage('   ')).toBe(QUERY_REQUIRED_MESSAGE);
    });

    it('allows export when a query is present', () => {
        expect(getExportValidationMessage('after:2026')).toBeNull();
    });
});
