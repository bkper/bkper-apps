import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ExchangeRates } from '../../../src/api/generated/types.js';
import { ExchangeUpdateController } from '../../../src/components/exchange-update/exchange-update-controller.js';
import type { ExchangeUpdateView } from '../../../src/components/exchange-update/exchange-update-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';

class TestView implements ReactiveControllerHost {
    book?: Book;
    date = '';
    exchangeRates?: ExchangeRates;
    ratesLoading = false;
    ratesError = '';
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

const originalLoadRates = botApiService.loadExchangeRates;

afterEach(() => {
    botApiService.loadExchangeRates = originalLoadRates;
});

function createController(view: TestView): ExchangeUpdateController {
    return new ExchangeUpdateController(view as unknown as ExchangeUpdateView);
}

describe('Exchange update controller', () => {
    it('loads rates for the supplied date', async () => {
        const book = new Book({
            id: 'book-id',
            timeZone: 'Invalid/Timezone',
        });
        const exchangeRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: 5.4 },
        };
        botApiService.loadExchangeRates = mock(async () => exchangeRates);
        const view = new TestView();
        view.book = book;
        view.date = exchangeRates.date;
        const controller = createController(view);

        await controller.initialize();

        expect(view.date).toBe(exchangeRates.date);
        expect(botApiService.loadExchangeRates).toHaveBeenCalledWith('book-id', view.date);
        expect(view.exchangeRates).toBe(exchangeRates);
    });

    it('keeps the Book and date available when rates cannot be loaded', async () => {
        const book = new Book({
            id: 'book-id',
            timeZone: 'UTC',
        });
        botApiService.loadExchangeRates = async () => {
            throw new Error('Rates unavailable');
        };
        const view = new TestView();
        view.book = book;
        view.date = '2026-08-06';
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { BRL: 5.3 },
        };
        const controller = createController(view);

        await controller.initialize();

        expect(view.book).toBe(book);
        expect(view.date).not.toBe('');
        expect(view.exchangeRates).toBeUndefined();
        expect(view.ratesError).not.toBe('');
        expect(view.ratesLoading).toBe(false);
    });

    it('keeps the latest rates when requests finish out of order', async () => {
        const oldRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { BRL: 5.3 },
        };
        const latestRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: 5.4 },
        };
        let resolveOldRates: (rates: ExchangeRates) => void = () => {};
        const oldRequest = new Promise<ExchangeRates>(resolve => {
            resolveOldRates = resolve;
        });
        let requestCount = 0;
        botApiService.loadExchangeRates = () => {
            requestCount++;
            return requestCount === 1 ? oldRequest : Promise.resolve(latestRates);
        };
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = oldRates.date;
        const controller = createController(view);

        const firstRequest = controller.loadRates();
        view.date = latestRates.date;
        await controller.loadRates();
        resolveOldRates(oldRates);
        await firstRequest;

        expect(view.exchangeRates).toBe(latestRates);
        expect(view.ratesError).toBe('');
        expect(view.ratesLoading).toBe(false);
    });

    it('ignores a stale error while the latest request is pending', async () => {
        const latestRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: 5.4 },
        };
        let rejectOldRates: (reason?: unknown) => void = () => {};
        const oldRequest = new Promise<ExchangeRates>((_resolve, reject) => {
            rejectOldRates = reject;
        });
        let resolveLatestRates: (rates: ExchangeRates) => void = () => {};
        const latestRequest = new Promise<ExchangeRates>(resolve => {
            resolveLatestRates = resolve;
        });
        let requestCount = 0;
        botApiService.loadExchangeRates = () => {
            requestCount++;
            return requestCount === 1 ? oldRequest : latestRequest;
        };
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = '2026-08-05';
        const controller = createController(view);

        const firstRequest = controller.loadRates();
        view.date = latestRates.date;
        const secondRequest = controller.loadRates();
        rejectOldRates(new Error('Old request failed'));
        await firstRequest;

        expect(view.ratesError).toBe('');
        expect(view.ratesLoading).toBe(true);

        resolveLatestRates(latestRates);
        await secondRequest;
        expect(view.exchangeRates).toBe(latestRates);
        expect(view.ratesLoading).toBe(false);
    });

    it('clears rates and ignores an in-flight response when the date is empty', async () => {
        const oldRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { BRL: 5.3 },
        };
        let resolveOldRates: (rates: ExchangeRates) => void = () => {};
        const oldRequest = new Promise<ExchangeRates>(resolve => {
            resolveOldRates = resolve;
        });
        const loadRates = mock(() => oldRequest);
        botApiService.loadExchangeRates = loadRates;
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = oldRates.date;
        view.ratesError = 'Previous error';
        const controller = createController(view);

        const firstRequest = controller.loadRates();
        view.date = '';
        await controller.loadRates();
        resolveOldRates(oldRates);
        await firstRequest;

        expect(loadRates).toHaveBeenCalledTimes(1);
        expect(view.exchangeRates).toBeUndefined();
        expect(view.ratesError).toBe('');
        expect(view.ratesLoading).toBe(false);
    });

    it('starts initialization whenever the view connects', async () => {
        const exchangeRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        botApiService.loadExchangeRates = mock(async () => exchangeRates);
        const view = new TestView();
        view.book = new Book({ id: 'book-id', timeZone: 'UTC' });
        view.date = exchangeRates.date;
        const controller = createController(view);

        controller.hostConnected();
        await Promise.resolve();
        controller.hostConnected();
        await Promise.resolve();

        expect(botApiService.loadExchangeRates).toHaveBeenCalledTimes(2);
    });
});
