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

/** The execution status of an Exchange Update for a Book. */
export enum ExchangeUpdateStatus {
    WAITING = 'WAITING',
    RETRYING = 'RETRYING',
    COMPLETE = 'COMPLETE',
    ERROR = 'ERROR',
}

/** Exchange Account names mapped to their formatted summed values. */
export type ExchangeUpdateSummary = Record<string, string>;

/** The client state for an Exchange Update executed on a Book. */
export interface ExchangeUpdateResult {
    /** The current execution status. */
    status: ExchangeUpdateStatus;
    /** The completed Exchange Update summary, when available. */
    summary?: ExchangeUpdateSummary;
    /** The final execution error, when available. */
    error?: string;
    /** The number of retries already attempted. */
    retryCount?: number;
    /** The maximum number of retries allowed. */
    retryLimit?: number;
}
