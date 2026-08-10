import { Amount, Permission, type Book, type Transaction } from 'bkper-js';
import { EXC_BASE_PROP, EXC_CODE_PROP } from './constants.js';

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
     * Tells whether the user can edit a Book.
     *
     * @param book - The Book whose current-user permission should be checked.
     * @returns `true` for owner or editor permission; otherwise, `false`.
     */
    static canEditBook(book: Book): boolean {
        const permission = book.getPermission();
        return permission === Permission.OWNER || permission === Permission.EDITOR ? true : false;
    }

    /**
     * Aggregates accepted Exchange Update movements by Exchange Account.
     *
     * @param transactions - SDK wrappers for transactions accepted by the Exchange Update API.
     * @returns Signed adjustment totals keyed by Exchange Account name.
     */
    static summarizeExchangeUpdateTransactions(transactions: Transaction[]): Map<string, Amount> {
        const adjustments = new Map<string, Amount>();

        for (const transaction of transactions) {
            const description = transaction.getDescription();
            const loss = description.includes('#exchange_loss');
            const gain = description.includes('#exchange_gain');
            if (!loss && !gain) {
                continue;
            }

            const payload = transaction.json();
            const accountName = loss ? payload.debitAccount?.name : payload.creditAccount?.name;
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
