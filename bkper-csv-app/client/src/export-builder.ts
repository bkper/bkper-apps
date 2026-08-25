import type { ExportOptions } from './export-config';
import { normalizeExportOptions } from './export-config';

export interface TransactionsDataTableBuilderLike {
    formatDates(format: boolean): TransactionsDataTableBuilderLike;
    formatValues(format: boolean): TransactionsDataTableBuilderLike;
    recordedAt(include: boolean): TransactionsDataTableBuilderLike;
    ids(include: boolean): TransactionsDataTableBuilderLike;
    properties(include: boolean): TransactionsDataTableBuilderLike;
    hiddenProperties(include: boolean): TransactionsDataTableBuilderLike;
    urls(include: boolean): TransactionsDataTableBuilderLike;
}

export function configureTransactionsDataTableBuilder<T extends TransactionsDataTableBuilderLike>(
    builder: T,
    options: ExportOptions
): T {
    const normalizedOptions = normalizeExportOptions(options);

    builder
        .formatDates(normalizedOptions.formatDates)
        .formatValues(normalizedOptions.formatValues)
        .recordedAt(normalizedOptions.includeRecordedAt)
        .ids(normalizedOptions.includeIds)
        .properties(normalizedOptions.includeProperties)
        .hiddenProperties(normalizedOptions.includeHiddenProperties)
        .urls(normalizedOptions.includeUrls);

    return builder;
}
