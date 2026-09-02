import { describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { CostOfGoodsSoldController } from '../../../src/components/cost-of-goods-sold/cost-of-goods-sold-controller.js';
import type { CostOfGoodsSoldView } from '../../../src/components/cost-of-goods-sold/cost-of-goods-sold-view.js';
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
        const calculateAccount = mock(
            async (_bookId: string, _account: Account, _date: string): Promise<void> => {}
        );
        Reflect.set(controller, 'calculateAccount', calculateAccount);

        await controller.runCalculate();

        expect(calculateAccount).toHaveBeenNthCalledWith(
            1,
            'inventory-book',
            view.context?.accounts[0],
            '2026-03-10'
        );
        expect(calculateAccount).toHaveBeenNthCalledWith(
            2,
            'inventory-book',
            view.context?.accounts[1],
            '2026-03-10'
        );
    });

    it('resets Inventory Accounts sequentially', async () => {
        const view = createView();
        const controller = createController(view);
        const resetAccount = mock(async (_bookId: string, _account: Account): Promise<void> => {});
        Reflect.set(controller, 'resetAccount', resetAccount);

        await controller.runReset();

        expect(resetAccount).toHaveBeenNthCalledWith(
            1,
            'inventory-book',
            view.context?.accounts[0]
        );
        expect(resetAccount).toHaveBeenNthCalledWith(
            2,
            'inventory-book',
            view.context?.accounts[1]
        );
    });

    it('does not execute operations when their operation-specific guards are disabled', async () => {
        const view = createView();
        const controller = createController(view);
        const calculateAccount = mock(
            async (_bookId: string, _account: Account, _date: string): Promise<void> => {}
        );
        const resetAccount = mock(async (_bookId: string, _account: Account): Promise<void> => {});
        Reflect.set(controller, 'calculateAccount', calculateAccount);
        Reflect.set(controller, 'resetAccount', resetAccount);

        view.date = '';
        await controller.runCalculate();
        view.context!.resetEnabled = false;
        await controller.runReset();

        expect(calculateAccount).not.toHaveBeenCalled();
        expect(resetAccount).not.toHaveBeenCalled();
    });
});
