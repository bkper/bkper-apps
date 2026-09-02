import type { Account } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
// import type { OperationResponse } from '../api/generated/types.js';
import {
    AccountOperationStatus,
    type AccountOperationContext,
    type AccountOperationResult,
    type AppError,
    type ExecutionChangeDetail,
} from '../types.js';

export interface AccountOperationViewHost<Context extends AccountOperationContext>
    extends ReactiveControllerHost, EventTarget {
    context?: Context;
    permissionError?: AppError;
    operationError?: AppError;
    executing: boolean;
    results: Map<string, AccountOperationResult>;
}

export abstract class AccountOperationController<
    Context extends AccountOperationContext,
    View extends AccountOperationViewHost<Context>,
> implements ReactiveController {
    protected readonly view: View;

    constructor(view: View) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {}
    hostDisconnected(): void {}

    protected validateContext(): Context | null {
        const context = this.view.context;
        if (!context || context.accounts.length === 0) {
            return null;
        }
        return context;
    }

    protected shouldDisableExecution(): boolean {
        return this.view.executing || this.view.permissionError !== undefined;
    }

    clearResults(): void {
        this.view.results = new Map();
        this.view.operationError = undefined;
    }

    protected async runAccountOperation(
        context: Context,
        executeAccount: (account: Account) => Promise<void>,
        startErrorFallback: string
    ): Promise<void> {
        this.setExecuting(true);
        this.clearResults();

        try {
            // const hasPendingTasks = await botService.hasPendingTasks(context.inventoryBook);
            // if (hasPendingTasks) {
            //     this.view.operationError = this.createOperationError(
            //         'Cannot start operation: Inventory Book has pending tasks.'
            //     );
            //     return;
            // }

            this.initializeWaitingResults(context.accounts);

            for (const account of context.accounts) {
                await executeAccount(account);
            }
        } catch (error: unknown) {
            this.view.operationError = this.createOperationError(
                this.formatError(error, startErrorFallback)
            );
        } finally {
            this.setExecuting(false);
        }
    }

    // protected async executeAccountOperation(
    //     inventoryAccount: Account,
    //     execute: (accountId: string) => Promise<OperationResponse>,
    //     errorFallback: string
    // ): Promise<void> {
    //     const inventoryAccountId = inventoryAccount.getId();
    //     if (!inventoryAccountId) {
    //         return;
    //     }
    //     try {
    //         const response = await execute(inventoryAccountId);
    //         this.setResult(inventoryAccountId, {
    //             status: AccountOperationStatus.COMPLETE,
    //             message: response.message,
    //         });
    //     } catch (error: unknown) {
    //         this.setResult(inventoryAccountId, {
    //             status: AccountOperationStatus.ERROR,
    //             error: this.formatError(error, errorFallback),
    //         });
    //     }
    // }

    private setExecuting(executing: boolean): void {
        this.view.executing = executing;
        this.view.dispatchEvent(
            new CustomEvent<ExecutionChangeDetail>('execution-changed', {
                detail: { executing },
                bubbles: true,
                composed: true,
            })
        );
    }

    private initializeWaitingResults(accounts: Account[]): void {
        const results = new Map<string, AccountOperationResult>();
        for (const account of accounts) {
            const accountId = account.getId();
            if (accountId) {
                results.set(accountId, { status: AccountOperationStatus.WAITING });
            }
        }
        this.view.results = results;
    }

    private setResult(accountId: string, result: AccountOperationResult): void {
        const results = new Map(this.view.results);
        results.set(accountId, result);
        this.view.results = results;
    }

    private createOperationError(message: string): AppError {
        return {
            type: 'error',
            message: { before: message },
        };
    }

    private formatError(error: unknown, fallback: string): string {
        return error instanceof Error ? error.message : fallback;
    }
}
