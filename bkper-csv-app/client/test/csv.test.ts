import { describe, expect, it } from 'bun:test';
import { createCsvFileName, dataTableToCsv } from '../src/csv';

describe('CSV serialization', () => {
    it('serializes rows with semicolon delimiters and CRLF line endings', () => {
        const csv = dataTableToCsv([
            ['Date', 'Description', 'Amount'],
            ['2026-06-03', 'Taxi', '12,50'],
        ], ';');

        expect(csv).toBe('Date;Description;Amount\r\n2026-06-03;Taxi;12,50');
    });

    it('quotes cells containing delimiters, quotes, or new lines', () => {
        const csv = dataTableToCsv([
            ['Description', 'Notes'],
            ['Taxi; airport', 'Driver said "ok"\npaid'],
        ], ';');

        expect(csv).toBe('Description;Notes\r\n"Taxi; airport";"Driver said ""ok""\npaid"');
    });

    it('converts nullish values to empty cells and dates to ISO strings', () => {
        const csv = dataTableToCsv([[null, undefined, new Date('2026-06-03T00:00:00.000Z')]], ';');

        expect(csv).toBe(';;2026-06-03T00:00:00.000Z');
    });

    it('uses the legacy timestamp filename pattern', () => {
        expect(createCsvFileName(1780425600000)).toBe('bkper_1780425600000.csv');
    });
});
