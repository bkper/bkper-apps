import type { Account, Book, Group } from 'bkper-js';

/** The current application state. */
export enum BotAppState {
    /** The application is loading its context. */
    LOADING = 'LOADING',
    /** The application is ready for an operation. */
    READY = 'READY',
    /** The application is executing an operation. */
    EXECUTING = 'EXECUTING',
    /** The application context could not be loaded. */
    ERROR = 'ERROR',
}

/** The execution state carried by an execution-change event. */
export interface ExecutionChangeDetail {
    /** Whether an Account operation is executing. */
    executing: boolean;
}

/** An execution state event dispatched by an operation component. */
export type ExecutionChangeEvent = CustomEvent<ExecutionChangeDetail>;

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

/** The resolved Account scope shared by Inventory Bot operations. */
export interface AccountOperationContext {
    /** The Inventory Book. */
    inventoryBook: Book;
    /** The selected Inventory Account, if any. */
    selectedAccount?: Account;
    /** The selected Inventory Group, if any. */
    selectedGroup?: Group;
    /** The eligible accounts to operate on. */
    accounts: Account[];
}

/** The execution status of an Account operation. */
export enum AccountOperationStatus {
    /** The Account is waiting for its operation to finish. */
    WAITING = 'WAITING',
    /** The Account operation completed successfully. */
    COMPLETE = 'COMPLETE',
    /** The Account operation failed. */
    ERROR = 'ERROR',
}

/** The client result of an operation executed for one Account. */
export interface AccountOperationResult {
    /** The current operation status. */
    status: AccountOperationStatus;
    /** The successful operation commentary, when available. */
    message?: string;
    /** The final operation error, when available. */
    error?: string;
}

/** The resolved context for realized-result operations. */
export interface CostOfGoodsSoldContext extends AccountOperationContext {
    /** Whether the Reset operation is enabled. */
    resetEnabled: boolean;
}
