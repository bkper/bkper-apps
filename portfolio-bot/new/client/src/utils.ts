import { Amount, Permission, type Book, type Transaction } from 'bkper-js';

/** Book permissions that allow the current user to view Book data. */
export const VIEW_PERMISSIONS: readonly Permission[] = [
    Permission.VIEWER,
    Permission.POSTER,
    Permission.EDITOR,
    Permission.OWNER,
];

/** Book permissions that allow the current user to edit Book data. */
export const EDIT_PERMISSIONS: readonly Permission[] = [Permission.EDITOR, Permission.OWNER];

/** General-purpose client utilities. */
export class Utils {
    /**
     * Tells whether the user can view a Book.
     *
     * @param book - The Book whose current-user permission should be checked.
     * @returns `true` for VIEWER, POSTER, EDITOR or OWNER permission; otherwise, `false`.
     */
    static canViewBook(book: Book): boolean {
        return VIEW_PERMISSIONS.includes(book.getPermission());
    }

    /**
     * Tells whether the user can edit a Book.
     *
     * @param book - The Book whose current-user permission should be checked.
     * @returns `true` for EDITOR or OWNER permission; otherwise, `false`.
     */
    static canEditBook(book: Book): boolean {
        return EDIT_PERMISSIONS.includes(book.getPermission());
    }

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
