import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { RealizedResultsController } from '../../../src/components/realized-results/realized-results-controller.js';
import type { RealizedResultsView } from '../../../src/components/realized-results/realized-results-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';
import { botService } from '../../../src/services/bot-service.js';
import {
    AccountOperationStatus,
    type AccountOperationResult,
    type AppError,
    type RealizedResultsContext,
} from '../../../src/types.js';

class TestView implements ReactiveControllerHost {
    context?: RealizedResultsContext;
    permissionError?: AppError;
    operationError?: AppError;
    date = '';
    performMtm = false;
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

const originalHasPendingTasks = botService.hasPendingTasks;
const originalCalculateAccount = botApiService.calculateAccount;
const originalResetAccount = botApiService.resetAccount;
const originalFullResetAccount = botApiService.fullResetAccount;

afterEach(() => {
    botService.hasPendingTasks = originalHasPendingTasks;
    botApiService.calculateAccount = originalCalculateAccount;
    botApiService.resetAccount = originalResetAccount;
    botApiService.fullResetAccount = originalFullResetAccount;
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
        resetEnabled: true,
        fullResetEnabled: false,
    };
    view.date = '2026-03-10';
    view.performMtm = true;
    return view;
}

function createController(view: TestView): RealizedResultsController {
    return new RealizedResultsController(view as unknown as RealizedResultsView);
}

describe('Realized results controller', () => {
    it('aborts the complete Calculate run when the Portfolio Book has pending tasks', async () => {
        botService.hasPendingTasks = mock(async () => true);
        botApiService.calculateAccount = mock(async () => ({ message: 'Calculated' }));
        const view = createView();
        const controller = createController(view);

        await controller.runCalculate();

        expect(botService.hasPendingTasks).toHaveBeenCalledTimes(1);
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
        expect(botApiService.calculateAccount).not.toHaveBeenCalled();
        expect(view.results.size).toBe(0);
        expect(view.operationError?.message.before).toBe(
            'Cannot start operation: Portfolio Book has pending tasks.'
        );
        expect(view.executing).toBe(false);
    });

    it('calculates Accounts concurrently with the current date and MTM intent', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let resolveFirst: (response: { message: string }) => void = () => {};
        const firstRequest = new Promise<{ message: string }>(resolve => {
            resolveFirst = resolve;
        });
        const requestedAccountIds: string[] = [];
        botApiService.calculateAccount = mock(async (_bookId, accountId) => {
            requestedAccountIds.push(accountId);
            return accountId === 'apple' ? firstRequest : { message: 'Alphabet calculated' };
        });
        const view = createView();
        const controller = createController(view);

        const calculation = controller.runCalculate();
        await Promise.resolve();
        await Promise.resolve();

        expect(view.executing).toBe(true);
        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(view.results.get('apple')).toEqual({ status: AccountOperationStatus.WAITING });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet calculated',
        });

        resolveFirst({ message: 'Apple calculated' });
        await calculation;

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(botApiService.calculateAccount).toHaveBeenNthCalledWith(
            1,
            'portfolio-book',
            'apple',
            { date: '2026-03-10', performMtm: true }
        );
        expect(botApiService.calculateAccount).toHaveBeenNthCalledWith(
            2,
            'portfolio-book',
            'alphabet',
            { date: '2026-03-10', performMtm: true }
        );
        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Apple calculated',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet calculated',
        });
        expect(view.executing).toBe(false);
    });

    it('records an Account error and continues with the remaining Accounts', async () => {
        botService.hasPendingTasks = mock(async () => false);
        botApiService.calculateAccount = mock(async (_bookId, accountId) => {
            if (accountId === 'apple') {
                throw new Error('Apple failed');
            }
            return { message: 'Alphabet calculated' };
        });
        const view = createView();
        const controller = createController(view);

        await controller.runCalculate();

        expect(botApiService.calculateAccount).toHaveBeenCalledTimes(2);
        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.ERROR,
            error: 'Apple failed',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet calculated',
        });
        expect(view.executing).toBe(false);
    });

    it('aborts the complete Reset run when the Portfolio Book has pending tasks', async () => {
        botService.hasPendingTasks = mock(async () => true);
        botApiService.resetAccount = mock(async () => ({ message: 'Reset' }));
        const view = createView();
        const controller = createController(view);

        await controller.runReset();

        expect(botService.hasPendingTasks).toHaveBeenCalledTimes(1);
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
        expect(botApiService.resetAccount).not.toHaveBeenCalled();
        expect(view.results.size).toBe(0);
        expect(view.operationError?.message.before).toBe(
            'Cannot start operation: Portfolio Book has pending tasks.'
        );
        expect(view.executing).toBe(false);
    });

    it('resets Accounts concurrently and continues after an Account error', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let rejectFirst: (error: Error) => void = () => {};
        const firstRequest = new Promise<{ message: string }>((_resolve, reject) => {
            rejectFirst = reject;
        });
        const requestedAccountIds: string[] = [];
        botApiService.resetAccount = mock(async (_bookId, accountId) => {
            requestedAccountIds.push(accountId);
            return accountId === 'apple' ? firstRequest : { message: 'Alphabet reset' };
        });
        const view = createView();
        const controller = createController(view);

        const reset = controller.runReset();
        await Promise.resolve();
        await Promise.resolve();

        expect(view.executing).toBe(true);
        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(view.results.get('apple')).toEqual({ status: AccountOperationStatus.WAITING });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet reset',
        });

        rejectFirst(new Error('Apple reset failed'));
        await reset;

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(botApiService.resetAccount).toHaveBeenNthCalledWith(1, 'portfolio-book', 'apple');
        expect(botApiService.resetAccount).toHaveBeenNthCalledWith(2, 'portfolio-book', 'alphabet');
        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.ERROR,
            error: 'Apple reset failed',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet reset',
        });
        expect(view.executing).toBe(false);
    });

    it('aborts the complete Full Reset run when the Portfolio Book has pending tasks', async () => {
        botService.hasPendingTasks = mock(async () => true);
        botApiService.fullResetAccount = mock(async () => ({ message: 'Fully reset' }));
        const view = createView();
        view.context!.fullResetEnabled = true;
        const controller = createController(view);

        await controller.runFullReset();

        expect(botService.hasPendingTasks).toHaveBeenCalledTimes(1);
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
        expect(botApiService.fullResetAccount).not.toHaveBeenCalled();
        expect(view.results.size).toBe(0);
        expect(view.operationError?.message.before).toBe(
            'Cannot start operation: Portfolio Book has pending tasks.'
        );
        expect(view.executing).toBe(false);
    });

    it('fully resets Accounts concurrently and continues after an Account error', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let rejectFirst: (error: Error) => void = () => {};
        const firstRequest = new Promise<{ message: string }>((_resolve, reject) => {
            rejectFirst = reject;
        });
        const requestedAccountIds: string[] = [];
        botApiService.fullResetAccount = mock(async (_bookId, accountId) => {
            requestedAccountIds.push(accountId);
            return accountId === 'apple' ? firstRequest : { message: 'Alphabet fully reset' };
        });
        const view = createView();
        view.context!.fullResetEnabled = true;
        const controller = createController(view);

        const fullReset = controller.runFullReset();
        await Promise.resolve();
        await Promise.resolve();

        expect(view.executing).toBe(true);
        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(view.results.get('apple')).toEqual({ status: AccountOperationStatus.WAITING });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet fully reset',
        });

        rejectFirst(new Error('Apple full reset failed'));
        await fullReset;

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(botApiService.fullResetAccount).toHaveBeenNthCalledWith(
            1,
            'portfolio-book',
            'apple'
        );
        expect(botApiService.fullResetAccount).toHaveBeenNthCalledWith(
            2,
            'portfolio-book',
            'alphabet'
        );
        expect(view.results.get('apple')).toEqual({
            status: AccountOperationStatus.ERROR,
            error: 'Apple full reset failed',
        });
        expect(view.results.get('alphabet')).toEqual({
            status: AccountOperationStatus.COMPLETE,
            message: 'Alphabet fully reset',
        });
        expect(view.executing).toBe(false);
    });

    it('clears stale Account results and operation errors', () => {
        const view = createView();
        view.results.set('apple', {
            status: AccountOperationStatus.COMPLETE,
            message: 'Calculated',
        });
        view.operationError = {
            type: 'error',
            message: { before: 'Previous operation failed.' },
        };
        const controller = createController(view);

        controller.clearResults();

        expect(view.results.size).toBe(0);
        expect(view.operationError).toBeUndefined();
    });
});
