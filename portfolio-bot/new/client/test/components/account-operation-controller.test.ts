import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
    AccountOperationController,
    type AccountOperationViewHost,
} from '../../src/components/account-operation-controller.js';
import { botService } from '../../src/services/bot-service.js';
import {
    AccountOperationStatus,
    type AccountOperationContext,
    type AccountOperationResult,
    type AppError,
} from '../../src/types.js';

class TestView implements AccountOperationViewHost<AccountOperationContext> {
    context?: AccountOperationContext;
    permissionError?: AppError;
    operationError?: AppError;
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

class TestController extends AccountOperationController<AccountOperationContext, TestView> {
    async run(): Promise<void> {
        const context = this.validateContext();
        if (!context) {
            return;
        }

        return this.runAccountOperation(
            context,
            account => {
                if (account.getId() === 'apple') {
                    throw new Error('Unexpected Apple failure');
                }
                return this.executeAccountOperation(
                    account,
                    async () => ({ message: 'Alphabet completed' }),
                    'Account operation failed.'
                );
            },
            'Operation could not be started.',
            true
        );
    }
}

const originalHasPendingTasks = botService.hasPendingTasks;

afterEach(() => {
    botService.hasPendingTasks = originalHasPendingTasks;
});

function createView(): TestView {
    const portfolioBook = new Book({ id: 'portfolio-book' });
    const view = new TestView();
    view.context = {
        portfolioBook,
        accounts: [
            new Account(portfolioBook, { id: 'apple', name: 'Apple' }),
            new Account(portfolioBook, { id: 'alphabet', name: 'Alphabet' }),
        ],
    };
    return view;
}

describe('Account operation controller', () => {
    it('associates an unexpected concurrent failure with its Account and continues', async () => {
        botService.hasPendingTasks = mock(async () => false);
        const view = createView();
        const controller = new TestController(view);

        await controller.run();

        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.ERROR,
            error: 'Unexpected Apple failure',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet completed',
        });
        expect(view.operationError).toBeUndefined();
        expect(view.executing).toBe(false);
    });
});
