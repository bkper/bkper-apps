import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { CostOfGoodsSoldController } from '../../../src/components/cost-of-goods-sold/cost-of-goods-sold-controller.js';
import type { CostOfGoodsSoldView } from '../../../src/components/cost-of-goods-sold/cost-of-goods-sold-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';
import { botService } from '../../../src/services/bot-service.js';
import type {
    AccountOperationResult,
    AppError,
    CostOfGoodsSoldContext,
} from '../../../src/types.js';

class TestView extends EventTarget implements ReactiveControllerHost {
    context?: CostOfGoodsSoldContext;
    permissionError?: AppError;
    operationError?: AppError;
    date = '';
    executing = false;
    results = new Map<string, AccountOperationResult>();
    readonly controllers: ReactiveController[] = [];
    readonly updateComplete = Promise.resolve(true);

    addController(controller: ReactiveController): void {
        this.controllers.push(controller);
    }

    removeController(controller: ReactiveController): void {
        const index = this.controllers.indexOf(controller);
        if (index >= 0) {
            this.controllers.splice(index, 1);
        }
    }

    requestUpdate(): void {}
}

const originalCalculateAccount = botApiService.calculateAccount;
const originalResetAccount = botApiService.resetAccount;
const originalHasPendingTasks = botService.hasPendingTasks;

beforeEach(() => {
    botService.hasPendingTasks = mock(async () => false);
    botApiService.calculateAccount = mock(async () => ({ message: 'Calculated' }));
    botApiService.resetAccount = mock(async () => ({ message: 'Reset' }));
});

afterEach(() => {
    botService.hasPendingTasks = originalHasPendingTasks;
    botApiService.calculateAccount = originalCalculateAccount;
    botApiService.resetAccount = originalResetAccount;
});

function createView(): TestView {
    const inventoryBook = new Book({ id: 'inventory-book' });
    const view = new TestView();
    view.context = {
        inventoryBook,
        accounts: [
            new Account(inventoryBook, { id: 'apple', name: 'Apple' }),
            new Account(inventoryBook, { id: 'banana', name: 'Banana' }),
        ],
        resetEnabled: true,
    };
    view.date = '2026-03-10';
    return view;
}

function createController(view: TestView): CostOfGoodsSoldController {
    return new CostOfGoodsSoldController(view as unknown as CostOfGoodsSoldView);
}

describe('Cost of goods sold controller', () => {
    it('calculates Inventory Accounts sequentially with the selected date', async () => {
        const view = createView();
        const controller = createController(view);
        await controller.runCalculate();

        expect(botApiService.calculateAccount).toHaveBeenNthCalledWith(
            1,
            'inventory-book',
            'apple',
            { date: '2026-03-10' }
        );
        expect(botApiService.calculateAccount).toHaveBeenNthCalledWith(
            2,
            'inventory-book',
            'banana',
            { date: '2026-03-10' }
        );
        expect(botService.hasPendingTasks).toHaveBeenCalledTimes(1);
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.inventoryBook);
    });

    it('resets Inventory Accounts sequentially', async () => {
        const view = createView();
        const controller = createController(view);
        await controller.runReset();

        expect(botApiService.resetAccount).toHaveBeenNthCalledWith(1, 'inventory-book', 'apple');
        expect(botApiService.resetAccount).toHaveBeenNthCalledWith(2, 'inventory-book', 'banana');
        expect(botService.hasPendingTasks).toHaveBeenCalledTimes(1);
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.inventoryBook);
    });

    it('does not execute operations when their operation-specific guards are disabled', async () => {
        const view = createView();
        const controller = createController(view);
        view.date = '';
        await controller.runCalculate();
        view.context!.resetEnabled = false;
        await controller.runReset();

        expect(botApiService.calculateAccount).not.toHaveBeenCalled();
        expect(botApiService.resetAccount).not.toHaveBeenCalled();
        expect(botService.hasPendingTasks).not.toHaveBeenCalled();
    });
});
