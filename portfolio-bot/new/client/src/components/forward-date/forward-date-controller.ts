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
}
