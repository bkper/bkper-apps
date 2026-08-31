import type { Account } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { OperationResponse } from '../api/generated/types.js';
import { botService } from '../services/bot-service.js';
import {
    AccountOperationStatus,
    type AccountOperationContext,
    type AccountOperationResult,
    type AppError,
} from '../types.js';

export interface AccountOperationViewHost<
    Context extends AccountOperationContext,
> extends ReactiveControllerHost {
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
        this.view.executing = true;
        this.clearResults();

        try {
            const hasPendingTasks = await botService.hasPendingTasks(context.portfolioBook);
            if (hasPendingTasks) {
                this.view.operationError = this.createOperationError(
                    'Cannot start operation: Portfolio Book has pending tasks.'
                );
                return;
            }

            this.initializeWaitingResults(context.accounts);

            for (const account of context.accounts) {
                await executeAccount(account);
            }
        } catch (error: unknown) {
            this.view.operationError = this.createOperationError(
                this.formatError(error, startErrorFallback)
            );
        } finally {
            this.view.executing = false;
        }
    }

    protected async executeAccountOperation(
        portfolioAccount: Account,
        execute: (accountId: string) => Promise<OperationResponse>,
        errorFallback: string
    ): Promise<void> {
        const portfolioAccountId = portfolioAccount.getId();
        if (!portfolioAccountId) {
            return;
        }
        try {
            const response = await execute(portfolioAccountId);
            this.setResult(portfolioAccountId, {
                status: AccountOperationStatus.COMPLETE,
                message: response.message,
            });
        } catch (error: unknown) {
            this.setResult(portfolioAccountId, {
                status: AccountOperationStatus.ERROR,
                error: this.formatError(error, errorFallback),
            });
        }
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
