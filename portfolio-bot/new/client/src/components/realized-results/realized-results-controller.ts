import type { Account } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { botApiService } from '../../services/bot-api-service.js';
import { botService } from '../../services/bot-service.js';
import { AccountOperationStatus, type AccountOperationResult, type AppError } from '../../types.js';
import type { RealizedResultsView } from './realized-results-view.js';

export class RealizedResultsController implements ReactiveController {
    private readonly view: RealizedResultsView;

    constructor(view: RealizedResultsView) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {}
    hostDisconnected(): void {}

    async runCalculate(): Promise<void> {
        const context = this.view.context;
        if (
            !context ||
            context.accounts.length === 0 ||
            this.view.executing ||
            this.view.permissionError !== undefined ||
            !this.view.date
        ) {
            return;
        }

        const portfolioBookId = context.portfolioBook.getId();
        const date = this.view.date;
        const performMtm = this.view.performMtm;

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

            const results = new Map<string, AccountOperationResult>();
            for (const account of context.accounts) {
                const accountId = account.getId();
                if (accountId) {
                    results.set(accountId, { status: AccountOperationStatus.WAITING });
                }
            }
            this.view.results = results;

            for (const account of context.accounts) {
                await this.calculateAccount(portfolioBookId, account, date, performMtm);
            }
        } catch (error: unknown) {
            this.view.operationError = this.createOperationError(
                this.formatError(error, 'Calculate could not be started. Please try again.')
            );
        } finally {
            this.view.executing = false;
        }
    }

    async runReset(): Promise<void> {
        const context = this.view.context;
        if (
            !context ||
            context.accounts.length === 0 ||
            this.view.executing ||
            this.view.permissionError !== undefined ||
            !context.resetEnabled
        ) {
            return;
        }

        const portfolioBookId = context.portfolioBook.getId();

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

            const results = new Map<string, AccountOperationResult>();
            for (const account of context.accounts) {
                const accountId = account.getId();
                if (accountId) {
                    results.set(accountId, { status: AccountOperationStatus.WAITING });
                }
            }
            this.view.results = results;

            for (const account of context.accounts) {
                await this.resetAccount(portfolioBookId, account);
            }
        } catch (error: unknown) {
            this.view.operationError = this.createOperationError(
                this.formatError(error, 'Reset could not be started. Please try again.')
            );
        } finally {
            this.view.executing = false;
        }
    }

    clearResults(): void {
        this.view.results = new Map();
        this.view.operationError = undefined;
    }

    private async calculateAccount(
        portfolioBookId: string,
        portfolioAccount: Account,
        date: string,
        performMtm: boolean
    ): Promise<void> {
        const portfolioAccountId = portfolioAccount.getId();
        if (!portfolioAccountId) {
            return;
        }
        try {
            const response = await botApiService.calculateAccount(
                portfolioBookId,
                portfolioAccountId,
                { date, performMtm }
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
                    'Calculation could not be completed. Please try again.'
                ),
            });
        }
    }

    private async resetAccount(portfolioBookId: string, portfolioAccount: Account): Promise<void> {
        const portfolioAccountId = portfolioAccount.getId();
        if (!portfolioAccountId) {
            return;
        }
        try {
            const response = await botApiService.resetAccount(portfolioBookId, portfolioAccountId);
            this.setResult(portfolioAccountId, {
                status: AccountOperationStatus.COMPLETE,
                message: response.message,
            });
        } catch (error: unknown) {
            this.setResult(portfolioAccountId, {
                status: AccountOperationStatus.ERROR,
                error: this.formatError(error, 'Reset could not be completed. Please try again.'),
            });
        }
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
