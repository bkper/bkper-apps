import { describe, expect, it } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
import {
    AccountOperationController,
    type AccountOperationViewHost,
} from '../../src/components/account-operation-controller.js';
import {
    AccountOperationStatus,
    type AccountOperationContext,
    type AccountOperationResult,
    type AppError,
} from '../../src/types.js';

class TestView extends EventTarget implements AccountOperationViewHost<AccountOperationContext> {
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
    execute: (account: Account) => Promise<void> = async () => {};

    async run(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution()) {
            return;
        }
        return this.runAccountOperation(
            context,
            account => this.execute(account),
            'Operation could not be started.'
        );
    }
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
    };
    return view;
}

describe('Account operation controller', () => {
    it('runs Accounts sequentially and announces execution changes', async () => {
        let finishFirst: () => void = () => {};
        const firstOperation = new Promise<void>(resolve => {
            finishFirst = resolve;
        });
        const requestedAccountIds: string[] = [];
        const view = createView();
        const controller = new TestController(view);
        controller.execute = async account => {
            requestedAccountIds.push(account.getId() ?? '');
            if (account.getId() === 'apple') {
                await firstOperation;
            }
        };
        const changes: boolean[] = [];
        view.addEventListener('execution-changed', event => {
            changes.push((event as CustomEvent<{ executing: boolean }>).detail.executing);
        });

        const operation = controller.run();
        await Promise.resolve();

        expect(requestedAccountIds).toEqual(['apple']);
        expect(changes).toEqual([true]);
        expect(view.results.get('apple')).toEqual({ status: AccountOperationStatus.WAITING });
        expect(view.results.get('banana')).toEqual({ status: AccountOperationStatus.WAITING });

        finishFirst();
        await operation;

        expect(requestedAccountIds).toEqual(['apple', 'banana']);
        expect(changes).toEqual([true, false]);
        expect(view.executing).toBe(false);
    });

    it('reports an operation-level failure and restores the idle state', async () => {
        const view = createView();
        const controller = new TestController(view);
        controller.execute = async () => {
            throw new Error('Operation failed');
        };

        await controller.run();

        expect(view.operationError?.message.before).toBe('Operation failed');
        expect(view.executing).toBe(false);
    });

    it('does not execute without valid context or availability', async () => {
        const view = createView();
        const controller = new TestController(view);
        const requestedAccountIds: string[] = [];
        controller.execute = async account => {
            requestedAccountIds.push(account.getId() ?? '');
        };

        view.permissionError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        await controller.run();
        view.permissionError = undefined;
        view.executing = true;
        await controller.run();
        view.executing = false;
        view.context!.accounts = [];
        await controller.run();

        expect(requestedAccountIds).toEqual([]);
    });

    it('clears stale Account results and operation errors', () => {
        const view = createView();
        view.results.set('apple', {
            status: AccountOperationStatus.COMPLETE,
            message: 'Completed',
        });
        view.operationError = {
            type: 'error',
            message: { before: 'Previous operation failed.' },
        };
        const controller = new TestController(view);

        controller.clearResults();

        expect(view.results.size).toBe(0);
        expect(view.operationError).toBeUndefined();
    });
});
