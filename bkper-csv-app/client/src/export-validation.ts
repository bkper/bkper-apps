export const QUERY_REQUIRED_MESSAGE =
    'Set a query or date range in the Book transactions view before exporting CSV.';

export function getExportValidationMessage(query: string): string | null {
    return query.trim() ? null : QUERY_REQUIRED_MESSAGE;
}
