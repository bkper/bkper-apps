import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { ForwardDateController } from '../../../src/components/forward-date/forward-date-controller.js';
import type { ForwardDateView } from '../../../src/components/forward-date/forward-date-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';
import { botService } from '../../../src/services/bot-service.js';
import type { AccountOperationResult, AppError, ForwardDateContext } from '../../../src/types.js';

class TestView implements ReactiveControllerHost {
    context?: ForwardDateContext;
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

const originalHasPendingTasks = botService.hasPendingTasks;
const originalForwardAccount = botApiService.forwardAccount;
const originalFullResetAccount = botApiService.fullResetAccount;

afterEach(() => {
    botService.hasPendingTasks = originalHasPendingTasks;
    botApiService.forwardAccount = originalForwardAccount;
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
        fullResetEnabled: false,
    };
    view.date = '2026-03-10';
    return view;
}

function createController(view: TestView): ForwardDateController {
    return new ForwardDateController(view as unknown as ForwardDateView);
}

describe('Forward Date controller', () => {
    it('forwards Accounts sequentially with the current date', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let resolveFirst: (response: { message: string }) => void = () => {};
        const firstRequest = new Promise<{ message: string }>(resolve => {
            resolveFirst = resolve;
        });
        const requestedAccountIds: string[] = [];
        botApiService.forwardAccount = mock(async (_bookId, accountId) => {
            requestedAccountIds.push(accountId);
            return accountId === 'apple' ? firstRequest : { message: 'Alphabet forwarded' };
        });
        const view = createView();
        const controller = createController(view);

        const forwarding = controller.runForward();
        await Promise.resolve();

        expect(requestedAccountIds).toEqual(['apple']);

        resolveFirst({ message: 'Apple forwarded' });
        await forwarding;

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
        expect(botApiService.forwardAccount).toHaveBeenNthCalledWith(1, 'portfolio-book', 'apple', {
            date: '2026-03-10',
        });
        expect(botApiService.forwardAccount).toHaveBeenNthCalledWith(
            2,
            'portfolio-book',
            'alphabet',
            { date: '2026-03-10' }
        );
    });

    it('fully resets Accounts concurrently', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let resolveFirst: (response: { message: string }) => void = () => {};
        const firstRequest = new Promise<{ message: string }>(resolve => {
            resolveFirst = resolve;
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

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);

        resolveFirst({ message: 'Apple fully reset' });
        await fullReset;

        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
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
    });

    it('does not execute without a date or when Full Reset is unavailable', async () => {
        botService.hasPendingTasks = mock(async () => false);
        botApiService.forwardAccount = mock(async () => ({ message: 'Forwarded' }));
        botApiService.fullResetAccount = mock(async () => ({ message: 'Fully reset' }));
        const view = createView();
        view.date = '';
        const controller = createController(view);

        await controller.runForward();
        await controller.runFullReset();

        expect(botService.hasPendingTasks).not.toHaveBeenCalled();
        expect(botApiService.forwardAccount).not.toHaveBeenCalled();
        expect(botApiService.fullResetAccount).not.toHaveBeenCalled();
    });
});
