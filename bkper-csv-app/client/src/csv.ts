import type { CsvDelimiter } from './export-config';

export type CsvCell = unknown;

export function dataTableToCsv(rows: CsvCell[][], delimiter: CsvDelimiter): string {
    return rows
        .map(row => row.map(cell => serializeCell(cell, delimiter)).join(delimiter))
        .join('\r\n');
}

export function createCsvFileName(timestampMs = Date.now()): string {
    return `bkper_${timestampMs}.csv`;
}

function serializeCell(cell: CsvCell, delimiter: CsvDelimiter): string {
    if (cell == null) {
        return '';
    }

    const text = cell instanceof Date ? cell.toISOString() : String(cell);
    const mustQuote =
        text.includes(delimiter) ||
        text.includes('"') ||
        text.includes('\r') ||
        text.includes('\n');

    if (!mustQuote) {
        return text;
    }

    return `"${text.replaceAll('"', '""')}"`;
}
