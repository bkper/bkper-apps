/**
 * Builds a query string for searching transactions by account name with optional date filters
 * @param goodAccountName The name of the account to search for
 * @param beforeDate Optional date to filter transactions before (format: YYYY-MM-DD)
 * @param afterDate Optional date to filter transactions after (format: YYYY-MM-DD)
 * @returns Query string in the format "account:'name' after:date before:date"
 */
export function getAccountQuery(
    goodAccountName: string,
    beforeDate?: string,
    afterDate?: string
): string {
    let query = `account:'${goodAccountName}'`;
    if (afterDate) {
        query += ` after:${afterDate}`;
    }
    if (beforeDate) {
        query += ` before:${beforeDate}`;
    }
    return query;
}
