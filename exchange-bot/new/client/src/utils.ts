import { Amount, Permission, type Book, type Transaction } from 'bkper-js';
import { EXC_BASE_PROP, EXC_CODE_PROP } from './constants.js';

const VIEW_PERMISSIONS: readonly Permission[] = [
    Permission.VIEWER,
    Permission.POSTER,
    Permission.EDITOR,
    Permission.OWNER,
];

const EDIT_PERMISSIONS: readonly Permission[] = [Permission.EDITOR, Permission.OWNER];

/** General-purpose client utilities. */
export class Utils {
    /**
     * Gets the configured exchange code of a Book.
     *
     * @param book - The Book whose exchange code should be read.
     * @returns The configured exchange code, or `undefined` when not configured.
     */
    static getExcCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    /**
     * Tells whether a Book is configured as an Exchange Bot base Book.
     *
     * @param book - The Book whose base configuration should be checked.
     * @returns `true` when the base property is present; otherwise, `false`.
     */
    static isBaseBook(book: Book): boolean {
        return book.getProperty(EXC_BASE_PROP) ? true : false;
    }

    /**
     * Tells whether a Book's Collection contains an Exchange Bot base Book.
     *
     * @param book - The Book whose Collection should be checked.
     * @returns `true` when any Collection Book is configured as a base Book.
     */
    static hasBaseBookInCollection(book: Book): boolean {
        const collection = book.getCollection();
        const collectionBooks = collection?.getBooks();
        if (collectionBooks) {
            for (const book of collectionBooks) {
                if (this.isBaseBook(book)) {
                    return true;
                }
            }
        }
        return false;
    }

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
     * Builds the view authorization error for a Book.
     *
     * @param book - The Book whose current-user permission should be described.
     * @returns A message containing the accepted and current permissions.
     */
    static getViewPermissionError(book: Book): string {
        return formatPermissionError(book.getPermission(), VIEW_PERMISSIONS);
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
     * Aggregates accepted Exchange Update movements by Exchange Account.
     *
     * @param transactions - SDK wrappers for transactions accepted by the Exchange Update API.
     * @returns A promise that resolves to signed adjustment totals keyed by Exchange Account name.
     */
    static async summarizeExchangeUpdate(
        transactions: Transaction[]
    ): Promise<Map<string, Amount>> {
        const adjustments = new Map<string, Amount>();

        for (const transaction of transactions) {
            const description = transaction.getDescription();
            const loss = description.includes('#exchange_loss');
            const gain = description.includes('#exchange_gain');
            if (!loss && !gain) {
                continue;
            }

            const accountName = loss
                ? await transaction.getDebitAccountName()
                : await transaction.getCreditAccountName();
            const amount = transaction.getAmount();
            if (!accountName || !amount) {
                continue;
            }

            const adjustment = loss ? amount : amount.times(-1);
            adjustments.set(
                accountName,
                adjustments.get(accountName)?.plus(adjustment) ?? adjustment
            );
        }

        return adjustments;
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

function formatPermissionError(
    currentPermission: Permission | undefined,
    allowedPermissions: readonly Permission[]
): string {
    const required = formatPermissionList(allowedPermissions);
    const current = currentPermission ?? 'unavailable';
    return `Required Book permission: ${required}. Current: ${current}.`;
}

function formatPermissionList(permissions: readonly Permission[]): string {
    if (permissions.length === 1) {
        return permissions[0];
    }
    if (permissions.length === 2) {
        return `${permissions[0]} or ${permissions[1]}`;
    }
    return `${permissions.slice(0, -1).join(', ')}, or ${permissions.at(-1)}`;
}
