import type { Account } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { botApiService } from '../../services/bot-api-service.js';
import { botService } from '../../services/bot-service.js';
import {
    AccountOperationStatus,
    type AccountOperationResult,
    type AppError,
    type ForwardDateContext,
} from '../../types.js';
import type { ForwardDateView } from './forward-date-view.js';

export class ForwardDateController implements ReactiveController {
    private readonly view: ForwardDateView;

    constructor(view: ForwardDateView) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {}
    hostDisconnected(): void {}

    private validateContext(): ForwardDateContext | null {
        const context = this.view.context;
        if (!context || context.accounts.length === 0) {
            return null;
        }
        return context;
    }

    private shouldDisableExecution(): boolean {
        return this.view.executing || this.view.permissionError !== undefined;
    }

    async runForward(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution() || !this.view.date) {
            return;
        }

        const portfolioBookId = context.portfolioBook.getId();
        const date = this.view.date;

        return this.runAccountOperation(
            context,
            account => this.forwardAccount(portfolioBookId, account, date),
            'Forward Date could not be started. Please try again.'
        );
    }

    clearResults(): void {
        this.view.results = new Map();
        this.view.operationError = undefined;
    }

    private async runAccountOperation(
        context: ForwardDateContext,
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

    private async forwardAccount(
        portfolioBookId: string,
        portfolioAccount: Account,
        date: string
    ): Promise<void> {
        const portfolioAccountId = portfolioAccount.getId();
        if (!portfolioAccountId) {
            return;
        }
        try {
            const response = await botApiService.forwardAccount(
                portfolioBookId,
                portfolioAccountId,
                { date }
            );
            this.setResult(portfolioAccountId, {
                status: AccountOperationStatus.COMPLETE,
                message: response.message,
            });
        } catch (error: unknown) {
            this.setResult(portfolioAccountId, {
                status: AccountOperationStatus.ERROR,
                error: this.formatError(
                    error,
                    'Forward Date could not be completed. Please try again.'
                ),
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
