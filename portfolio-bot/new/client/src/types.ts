import type { Account, Book, Group } from 'bkper-js';

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

/** The resolved context for realized-result operations. */
export interface RealizedResultsContext {
    /** The Portfolio Book. */
    portfolioBook: Book;
    /** The Base Book, when one can be resolved. */
    baseBook?: Book;
    /** Required Financial Books mapped by currency. */
    financialBooks: Map<string, Book>;
    /** The selected Portfolio Account, if any. */
    selectedAccount?: Account;
    /** The selected Portfolio Group, if any. */
    selectedGroup?: Group;
    /** The eligible accounts to operate on. */
    accounts: Account[];
    /** Whether reset operations are enabled. */
    resetEnabled: boolean;
}
