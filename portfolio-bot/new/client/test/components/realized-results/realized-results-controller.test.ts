import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { RealizedResultsController } from '../../../src/components/realized-results/realized-results-controller.js';
import type { RealizedResultsView } from '../../../src/components/realized-results/realized-results-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';
import { botService } from '../../../src/services/bot-service.js';
import type {
    AccountOperationResult,
    AppError,
    RealizedResultsContext,
} from '../../../src/types.js';

class TestView extends EventTarget implements ReactiveControllerHost {
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

afterEach(() => {
    botService.hasPendingTasks = originalHasPendingTasks;
    botApiService.calculateAccount = originalCalculateAccount;
    botApiService.resetAccount = originalResetAccount;
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
    };
    view.date = '2026-03-10';
    view.performMtm = true;
    return view;
}

function createController(view: TestView): RealizedResultsController {
    return new RealizedResultsController(view as unknown as RealizedResultsView);
}

describe('Realized results controller', () => {
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

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);

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
        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
    });

    it('resets Accounts concurrently through the regular Reset endpoint', async () => {
        botService.hasPendingTasks = mock(async () => false);
        let resolveFirst: (response: { message: string }) => void = () => {};
        const firstRequest = new Promise<{ message: string }>(resolve => {
            resolveFirst = resolve;
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

        expect(requestedAccountIds).toEqual(['apple', 'alphabet']);

        resolveFirst({ message: 'Apple reset' });
        await reset;

        expect(botService.hasPendingTasks).toHaveBeenCalledWith(view.context?.portfolioBook);
        expect(botApiService.resetAccount).toHaveBeenNthCalledWith(1, 'portfolio-book', 'apple');
        expect(botApiService.resetAccount).toHaveBeenNthCalledWith(2, 'portfolio-book', 'alphabet');
    });

    it('does not execute operations when their operation-specific guards are disabled', async () => {
        botService.hasPendingTasks = mock(async () => false);
        botApiService.calculateAccount = mock(async () => ({ message: 'Calculated' }));
        botApiService.resetAccount = mock(async () => ({ message: 'Reset' }));
        const view = createView();
        const controller = createController(view);

        view.date = '';
        await controller.runCalculate();
        view.context!.resetEnabled = false;
        await controller.runReset();

        expect(botService.hasPendingTasks).not.toHaveBeenCalled();
        expect(botApiService.calculateAccount).not.toHaveBeenCalled();
        expect(botApiService.resetAccount).not.toHaveBeenCalled();
    });
});
