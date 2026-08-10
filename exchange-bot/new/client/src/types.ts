import type { Book } from 'bkper-js';

/** A Bkper Book with the context needed by the Exchange Bot client. */
export interface ExchangeBotBook {
    /** The Bkper Book instance. */
    book: Book;
    /** The exchange currency code configured for the Book, when available. */
    excCode: string | undefined;
    /** Whether the Book is configured as a base Book in its Collection. */
    isBase: boolean;
}
