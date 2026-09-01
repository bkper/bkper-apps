import type { Account, Book, Group } from 'bkper-js';

/** A Portfolio Bot service available in the client. */
export enum PortfolioService {
    /** Realized-result calculation and reset operations. */
    REALIZED_RESULTS = 'realized-results',
    /** Forward Date operations. */
    FORWARD_DATE = 'forward-date',
}

/** The selected service carried by a service-change event. */
export interface ServiceChangeDetail {
    /** The service selected by the user. */
    service: PortfolioService;
}

/** A service selection event dispatched by the service switcher. */
export type ServiceChangeEvent = CustomEvent<ServiceChangeDetail>;

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
export interface RealizedResultsContext extends AccountOperationContext {
    /** Whether the Reset operation is enabled. */
    resetEnabled: boolean;
}

/** The resolved context for Forward Date operations. */
export interface ForwardDateContext extends AccountOperationContext {
    /** Whether the Full Reset operation is enabled. */
    fullResetEnabled: boolean;
}
