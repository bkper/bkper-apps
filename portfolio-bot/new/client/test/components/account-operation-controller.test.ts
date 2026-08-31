import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
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
    concurrent = false;
    unexpectedFailureAccountId?: string;
    request: (accountId: string) => Promise<{ message: string }> = async accountId => ({
        message: `${accountId} completed`,
    });

    async run(): Promise<void> {
        const context = this.validateContext();
        if (!context || this.shouldDisableExecution()) {
            return;
        }

        return this.runAccountOperation(
            context,
            account => {
                if (account.getId() === this.unexpectedFailureAccountId) {
                    throw new Error(`Unexpected ${account.getName()} failure`);
                }
                return this.executeAccountOperation(
                    account,
                    accountId => this.request(accountId),
                    'Account operation failed.'
                );
            },
            'Operation could not be started.',
            this.concurrent
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
    it('aborts before Account requests when the Portfolio Book has pending tasks', async () => {
        botService.hasPendingTasks = mock(async () => true);
        const view = createView();
        const controller = new TestController(view);
        controller.request = mock(async () => ({ message: 'Completed' }));

        await controller.run();

        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
        expect(controller.request).not.toHaveBeenCalled();
        expect(view.results.size).toBe(0);
        expect(view.operationError?.message.before).toBe(
            'Cannot start operation: Portfolio Book has pending tasks.'
        );
        expect(view.executing).toBe(false);
    });

    it('runs sequentially, tracks waiting Accounts, and continues after a request failure', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let rejectFirst: (error: Error) => void = () => {};
        const firstRequest = new Promise<{ message: string }>((_resolve, reject) => {
            rejectFirst = reject;
        });
        const requestedAccountIds: string[] = [];
        const view = createView();
        const controller = new TestController(view);
        controller.request = mock(async accountId => {
            requestedAccountIds.push(accountId);
            return accountId === 'apple' ? firstRequest : { message: 'Alphabet completed' };
        });

        const operation = controller.run();
        await Promise.resolve();
        await Promise.resolve();

        expect(view.executing).toBe(true);
        expect(requestedAccountIds).toEqual(['apple']);
        expect(view.results.get('apple')).toEqual({ status: AccountOperationStatus.WAITING });
        expect(view.results.get('alphabet')).toEqual({ status: AccountOperationStatus.WAITING });

        rejectFirst(new Error('Apple request failed'));
        await operation;

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.ERROR,
            error: 'Apple request failed',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet completed',
        });
        expect(view.operationError).toBeUndefined();
        expect(view.executing).toBe(false);
    });

    it('associates an unexpected concurrent failure with its Account and continues', async () => {
        botService.hasPendingTasks = mock(async () => false);
        const view = createView();
        const controller = new TestController(view);
        controller.concurrent = true;
        controller.unexpectedFailureAccountId = 'apple';

        await controller.run();

        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.ERROR,
            error: 'Unexpected Apple failure',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'alphabet completed',
        });
        expect(view.operationError).toBeUndefined();
        expect(view.executing).toBe(false);
    });

    it('does not execute without valid context, permission, or availability', async () => {
        botService.hasPendingTasks = mock(async () => false);
        const view = createView();
        const controller = new TestController(view);
        controller.request = mock(async () => ({ message: 'Completed' }));

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

        expect(botService.hasPendingTasks).not.toHaveBeenCalled();
        expect(controller.request).not.toHaveBeenCalled();
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
