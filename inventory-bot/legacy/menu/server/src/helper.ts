namespace helper {

    /**
     * Builds a query string for searching transactions by account name with optional date filters
     * @param goodAccountName The name of the account to search for
     * @param beforeDate Optional date to filter transactions before (format: YYYY-MM-DD)
     * @param afterDate Optional date to filter transactions after (format: YYYY-MM-DD)
     * @returns Query string in the format "account:'name' after:date before:date"
     */
    export function getAccountQuery(goodAccountName: string, beforeDate?: string, afterDate?: string): string {
        let query = `account:'${goodAccountName}'`;

        if (afterDate) {
            query += ` after:${afterDate}`
        }

        if (beforeDate) {
            query += ` before:${beforeDate}`
        }
        return query;
    }

    /**
     * Converts an ISO date string (YYYY-MM-DD) to a Date object
     * Sets the time to 13:00:00 for consistent timezone handling
     * @param isoDate Date string in YYYY-MM-DD format
     * @returns Date object representing the input date at 13:00:00
     */
    export function parseDate(isoDate: string): Date {
        const dateSplit = isoDate.split('-');
        const year = parseInt(dateSplit[0]);
        const month = parseInt(dateSplit[1]) - 1;
        const day = parseInt(dateSplit[2]);
        return new Date(year, month, day, 13, 0, 0, 0);
    }

    /**
     * Gets the time range in milliseconds for querying additional costs and credits
     * Calculated as: ADDITIONAL_COSTS_CREDITS_QUERY_RANGE * 30 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
     * @returns Time range in milliseconds
     */
    export function getTimeRange(months: number): number {
        return months * 30 * 24 * 60 * 60 * 1000;
    }
}