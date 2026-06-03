export type CsvDelimiter = ';' | ',';

export interface ExportOptions {
    formatDates: boolean;
    formatValues: boolean;
    includeRecordedAt: boolean;
    includeIds: boolean;
    includeProperties: boolean;
    includeHiddenProperties: boolean;
    includeUrls: boolean;
    delimiter: CsvDelimiter;
}

export const defaultExportOptions: ExportOptions = {
    formatDates: true,
    formatValues: true,
    includeRecordedAt: true,
    includeIds: false,
    includeProperties: false,
    includeHiddenProperties: false,
    includeUrls: false,
    delimiter: ';',
};

export function normalizeExportOptions(options: ExportOptions): ExportOptions {
    return {
        ...options,
        includeHiddenProperties: options.includeProperties ? options.includeHiddenProperties : false,
    };
}
