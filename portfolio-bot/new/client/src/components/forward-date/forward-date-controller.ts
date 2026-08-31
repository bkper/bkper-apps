import type { Account } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { botApiService } from '../../services/bot-api-service.js';
import type { AppError, ForwardDateContext } from '../../types.js';
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

        this.view.executing = true;
        this.clearOperationError();

        try {
            for (const account of context.accounts) {
                await this.forwardAccount(portfolioBookId, account, date);
            }
        } catch (error: unknown) {
            this.view.operationError = this.createOperationError(
                this.formatError(error, 'Forward Date could not be completed. Please try again.')
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
        await botApiService.forwardAccount(portfolioBookId, portfolioAccountId, { date });
    }

    private createOperationError(message: string): AppError {
        return {
            type: 'error',
            message: { before: message },
        };
    }

    clearOperationError(): void {
        this.view.operationError = undefined;
    }

    private formatError(error: unknown, fallback: string): string {
        return error instanceof Error ? error.message : fallback;
    }
}
