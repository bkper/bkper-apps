import type { Account } from 'bkper-js';
import { botApiService } from '../../services/bot-api-service.js';
import type { RealizedResultsContext } from '../../types.js';
import { AccountOperationController } from '../account-operation-controller.js';
import type { RealizedResultsView } from './realized-results-view.js';

export class RealizedResultsController extends AccountOperationController<
    RealizedResultsContext,
    RealizedResultsView
> {
    async runCalculate(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution() || !this.view.date) {
            return;
        }

        const portfolioBookId = context.portfolioBook.getId();
        const date = this.view.date;
        const performMtm = this.view.performMtm;

        return this.runAccountOperation(
            context,
            account => this.calculateAccount(portfolioBookId, account, date, performMtm),
            'Calculate could not be started. Please try again.',
            true
        );
    }

    async runReset(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution() || !context.resetEnabled) {
            return;
        }

        const portfolioBookId = context.portfolioBook.getId();

        return this.runAccountOperation(
            context,
            account => this.resetAccount(portfolioBookId, account, false),
            'Reset could not be started. Please try again.',
            true
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
            account => this.resetAccount(portfolioBookId, account, true),
            'Full Reset could not be started. Please try again.',
            true
        );
    }

    private async calculateAccount(
        portfolioBookId: string,
        portfolioAccount: Account,
        date: string,
        performMtm: boolean
    ): Promise<void> {
        return this.executeAccountOperation(
            portfolioAccount,
            accountId =>
                botApiService.calculateAccount(portfolioBookId, accountId, { date, performMtm }),
            'Calculation could not be completed. Please try again.'
        );
    }

    private async resetAccount(
        portfolioBookId: string,
        portfolioAccount: Account,
        full: boolean
    ): Promise<void> {
        const operation = full ? 'Full Reset' : 'Reset';
        return this.executeAccountOperation(
            portfolioAccount,
            accountId =>
                full
                    ? botApiService.fullResetAccount(portfolioBookId, accountId)
                    : botApiService.resetAccount(portfolioBookId, accountId),
            `${operation} could not be completed. Please try again.`
        );
    }
}
