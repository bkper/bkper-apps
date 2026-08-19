import type { Book } from 'bkper-js';

/** An application error shown to the user. */
export interface AppError {
    /** The presentation severity of the error. */
    type: 'info' | 'error';
    /** An optional error heading. */
    title?: string;
    /** The error message, optionally containing an inline link action. */
    message: {
        before?: string;
        action?: {
            label: string;
            url: string;
        };
        after?: string;
    };
}

/** A Bkper Book with the context needed by the Portfolio Bot client. */
export interface PortfolioBotBook {
    /** The Bkper Book instance. */
    book: Book;
}
