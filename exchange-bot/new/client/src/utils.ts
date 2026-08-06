/** General-purpose client utilities. */
export class Utils {
    /**
     * Formats a date as an ISO calendar date in the specified timezone.
     *
     * @param date - The instant to format.
     * @param timeZone - The IANA timezone used to determine the calendar date.
     * @returns The calendar date in `yyyy-MM-dd` format.
     */
    static getIsoDateInTimeZone(date: Date, timeZone?: string): string {
        const parts = new Intl.DateTimeFormat('en-US', {
            calendar: 'gregory',
            day: '2-digit',
            month: '2-digit',
            numberingSystem: 'latn',
            timeZone,
            year: 'numeric',
        }).formatToParts(date);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        const day = parts.find(part => part.type === 'day')?.value;
        if (!year || !month || !day) {
            throw new Error('The default date could not be determined');
        }
        return `${year}-${month}-${day}`;
    }
}
