import { describe, expect, it } from 'bun:test';
import { defaultExportOptions, normalizeExportOptions } from '../src/export-config';

describe('export options', () => {
    it('uses old-compatible defaults for CSV exports', () => {
        expect(defaultExportOptions).toEqual({
            formatDates: true,
            formatValues: true,
            includeRecordedAt: true,
            includeIds: false,
            includeProperties: false,
            includeHiddenProperties: false,
            includeUrls: false,
            delimiter: ';',
        });
    });

    it('disables hidden properties when properties are not exported', () => {
        const options = normalizeExportOptions({
            ...defaultExportOptions,
            includeProperties: false,
            includeHiddenProperties: true,
        });

        expect(options.includeHiddenProperties).toBe(false);
    });
});
