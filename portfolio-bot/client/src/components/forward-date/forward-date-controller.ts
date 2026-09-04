import type { Account } from 'bkper-js';
import { botApiService } from '../../services/bot-api-service.js';
import type { ForwardDateContext } from '../../types.js';
import { AccountOperationController } from '../account-operation-controller.js';
import type { ForwardDateView } from './forward-date-view.js';

export class ForwardDateController extends AccountOperationController<
    ForwardDateContext,
    ForwardDateView
> {
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

    async runFullReset(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution() || !context.fullResetEnabled) {
            return;
        }

        const portfolioBookId = context.portfolioBook.getId();

        return this.runAccountOperation(
            context,
            account => this.fullResetAccount(portfolioBookId, account),
            'Full Reset could not be started. Please try again.',
            true
        );
    }

    private async forwardAccount(
        portfolioBookId: string,
        portfolioAccount: Account,
        date: string
    ): Promise<void> {
        return this.executeAccountOperation(
            portfolioAccount,
            accountId => botApiService.forwardAccount(portfolioBookId, accountId, { date }),
            'Forward Date could not be completed. Please try again.'
        );
    }

    private async fullResetAccount(
        portfolioBookId: string,
        portfolioAccount: Account
    ): Promise<void> {
        return this.executeAccountOperation(
            portfolioAccount,
            accountId => botApiService.fullResetAccount(portfolioBookId, accountId),
            'Full Reset could not be completed. Please try again.'
        );
    }
}
