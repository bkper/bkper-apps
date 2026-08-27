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

/** The resolved Account scope shared by Portfolio Bot operations. */
export interface AccountOperationContext {
    /** The Portfolio Book. */
    portfolioBook: Book;
    /** The selected Portfolio Account, if any. */
    selectedAccount?: Account;
    /** The selected Portfolio Group, if any. */
    selectedGroup?: Group;
    /** The eligible accounts to operate on. */
    accounts: Account[];
}

/** The resolved context for realized-result operations. */
export interface RealizedResultsContext extends AccountOperationContext {
    /** Whether the Reset operation is enabled. */
    resetEnabled: boolean;
    /** Whether the Full Reset operation is enabled. */
    fullResetEnabled: boolean;
}

/** The resolved context for Forward Date operations. */
export type ForwardDateContext = AccountOperationContext;
