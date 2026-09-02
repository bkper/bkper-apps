import type { Account } from 'bkper-js';
import type { CostOfGoodsSoldContext } from '../../types.js';
import { AccountOperationController } from '../account-operation-controller.js';
import type { CostOfGoodsSoldView } from './cost-of-goods-sold-view.js';

export class CostOfGoodsSoldController extends AccountOperationController<
    CostOfGoodsSoldContext,
    CostOfGoodsSoldView
> {
    async runCalculate(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution() || !this.view.date) {
            return;
        }

        const inventoryBookId = context.inventoryBook.getId();
        const date = this.view.date;

        return this.runAccountOperation(
            context,
            account => this.calculateAccount(inventoryBookId, account, date),
            'Calculate could not be started. Please try again.'
        );
    }

    async runReset(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution() || !context.resetEnabled) {
            return;
        }

        const inventoryBookId = context.inventoryBook.getId();

        return this.runAccountOperation(
            context,
            account => this.resetAccount(inventoryBookId, account),
            'Reset could not be started. Please try again.'
        );
    }

    private async calculateAccount(
        inventoryBookId: string,
        inventoryAccount: Account,
        date: string
    ): Promise<void> {
        // return this.executeAccountOperation(
        //     inventoryAccount,
        //     accountId => botApiService.calculateAccount(inventoryBookId, accountId, { date }),
        //     'Calculation could not be completed. Please try again.'
        // );
    }

    private async resetAccount(inventoryBookId: string, inventoryAccount: Account): Promise<void> {
        // return this.executeAccountOperation(
        //     inventoryAccount,
        //     accountId => botApiService.resetAccount(inventoryBookId, accountId),
        //     'Reset could not be completed. Please try again.'
        // );
    }
}
