import { AccountType, Permission, type Account, type Book } from 'bkper-js';
import { EXC_CODE_PROP } from './constants.js';

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
     * Tells whether the user owns a Book.
     *
     * @param book - The Book whose current-user permission should be checked.
     * @returns `true` for OWNER permission; otherwise, `false`.
     */
    static isBookOwner(book: Book): boolean {
        return book.getPermission() === Permission.OWNER;
    }

    /**
     * Gets the first Inventory exchange code configured on an eligible Account.
     *
     * @param account - The Account whose Groups should be inspected.
     * @returns The configured exchange code, or `null` when the Account is not eligible.
     */
    static async getExchangeCode(account: Account): Promise<string | null> {
        const type = account.getType();
        if (type === AccountType.INCOMING || type === AccountType.OUTGOING) {
            return null;
        }
        for (const group of await account.getGroups()) {
            const exchangeCode = group.getProperty(EXC_CODE_PROP);
            if (exchangeCode != null && exchangeCode.trim() !== '') {
                return exchangeCode;
            }
        }
        return null;
    }

    /**
     * Gets the unique Inventory exchange codes configured on the supplied Accounts.
     *
     * Accounts without an eligible exchange code are omitted. Exchange codes retain
     * the order in which they are first found.
     *
     * @param accounts - The Accounts whose exchange codes should be collected.
     * @returns The unique configured exchange codes in first-found order.
     */
    static async getExchangeCodes(accounts: Account[]): Promise<Set<string>> {
        const exchangeCodes = new Set<string>();
        for (const account of accounts) {
            const exchangeCode = await Utils.getExchangeCode(account);
            if (exchangeCode) {
                exchangeCodes.add(exchangeCode);
            }
        }
        return exchangeCodes;
    }

    /**
     * Tells whether an Account is eligible for Inventory Bot item context.
     *
     * An eligible Inventory Account is permanent and assigned to at least one Group with a
     * non-empty `exc_code` property.
     *
     * @param account - The Inventory Book Account to evaluate.
     * @returns `true` when the Account is an eligible Inventory item; otherwise, `false`.
     */
    static async isEligibleInventoryAccount(account: Account): Promise<boolean> {
        if (!account.isPermanent()) {
            return false;
        }
        const excCode = await Utils.getExchangeCode(account);
        return excCode !== null;
    }

    /**
     * Tells whether a browser message is a trusted Bkper App URL change.
     *
     * @param event - The untrusted browser message to validate.
     * @param parent - The trusted parent window expected to send the message.
     * @param origin - The trusted parent origin expected to send the message.
     * @returns `true` when the sender and App URL change payload are valid.
     */
    static isTrustedAppUrlChangeEvent(
        event: MessageEvent<unknown>,
        parent: WindowProxy,
        origin: string
    ): event is MessageEvent<{ type: 'bkper:app-url-changed'; url: string }> {
        const message = event.data;
        return (
            event.source === parent &&
            event.origin === origin &&
            typeof message === 'object' &&
            message !== null &&
            'type' in message &&
            message.type === 'bkper:app-url-changed' &&
            'url' in message &&
            typeof message.url === 'string'
        );
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
