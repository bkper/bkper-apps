import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { ForwardDateController } from '../../../src/components/forward-date/forward-date-controller.js';
import type { ForwardDateView } from '../../../src/components/forward-date/forward-date-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';
import type { AppError, ForwardDateContext } from '../../../src/types.js';

class TestView implements ReactiveControllerHost {
    context?: ForwardDateContext;
    permissionError?: AppError;
    operationError?: AppError;
    date = '';
    executing = false;
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

const originalForwardAccount = botApiService.forwardAccount;

afterEach(() => {
    botApiService.forwardAccount = originalForwardAccount;
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
    view.date = '2026-03-10';
    return view;
}

function createController(view: TestView): ForwardDateController {
    return new ForwardDateController(view as unknown as ForwardDateView);
}

describe('Forward Date controller', () => {
    it('forwards Accounts sequentially with the current date', async () => {
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

        expect(view.executing).toBe(true);
        expect(requestedAccountIds).toEqual(['apple']);

        resolveFirst({ message: 'Apple forwarded' });
        await forwarding;

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);
        expect(botApiService.forwardAccount).toHaveBeenNthCalledWith(1, 'portfolio-book', 'apple', {
            date: '2026-03-10',
        });
        expect(botApiService.forwardAccount).toHaveBeenNthCalledWith(
            2,
            'portfolio-book',
            'alphabet',
            { date: '2026-03-10' }
        );
        expect(view.operationError).toBeUndefined();
        expect(view.executing).toBe(false);
    });

    it('surfaces an operation failure and restores the controls', async () => {
        botApiService.forwardAccount = mock(async () => {
            throw new Error('Forward Date failed');
        });
        const view = createView();
        const controller = createController(view);

        await controller.runForward();

        expect(botApiService.forwardAccount).toHaveBeenCalledTimes(1);
        expect(view.operationError?.message.before).toBe('Forward Date failed');
        expect(view.executing).toBe(false);
    });

    it('does not execute without available context, permission, or a date', async () => {
        botApiService.forwardAccount = mock(async () => ({ message: 'Forwarded' }));
        const view = createView();
        const controller = createController(view);

        view.permissionError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        await controller.runForward();
        view.permissionError = undefined;
        view.date = '';
        await controller.runForward();
        view.date = '2026-03-10';
        view.context!.accounts = [];
        await controller.runForward();

        expect(botApiService.forwardAccount).not.toHaveBeenCalled();
        expect(view.executing).toBe(false);
    });

    it('clears a stale operation error', () => {
        const view = createView();
        view.operationError = {
            type: 'error',
            message: { before: 'Previous operation failed.' },
        };
        const controller = createController(view);

        controller.clearOperationError();

        expect(view.operationError).toBeUndefined();
    });
});
