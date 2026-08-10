import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ExchangeRates } from '../../../src/api/generated/types.js';
import type { BotAppBook } from '../../../src/components/exchange-update/exchange-update-view.js';
import { ExchangeUpdateController } from '../../../src/components/exchange-update/exchange-update-controller.js';
import type { ExchangeUpdateView } from '../../../src/components/exchange-update/exchange-update-view.js';
import { botApiService } from '../../../src/services/bot-api-service.js';

class TestView implements ReactiveControllerHost {
    book?: Book;
    date = '';
    exchangeRates?: ExchangeRates;
    ratesLoading = false;
    ratesError = '';
    books: BotAppBook[] = [];
    executing = false;
    results = new Map<string, { status: string; summary?: string; error?: string }>();
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
const originalPerformExchangeUpdate = botApiService.performExchangeUpdate;

afterEach(() => {
    botApiService.loadExchangeRates = originalLoadRates;
    botApiService.performExchangeUpdate = originalPerformExchangeUpdate;
});

function createController(view: TestView): ExchangeUpdateController {
    return new ExchangeUpdateController(view as unknown as ExchangeUpdateView);
}

describe('Exchange update controller', () => {
    it('runs edited rates once for each eligible Book and summarizes accepted movements', async () => {
        const exchangeRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: '5.4' },
        };
        let resolveUpdate: (transactions: bkper.Transaction[]) => void = () => {};
        const updateRequest = new Promise<bkper.Transaction[]>(resolve => {
            resolveUpdate = resolve;
        });
        botApiService.performExchangeUpdate = mock(async () => updateRequest);
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [
            { id: 'usd-book', code: 'USD', isBase: true, fractionDigits: 2 },
            { id: 'brl-book', code: 'BRL', isBase: false, fractionDigits: 2 },
        ];
        view.exchangeRates = exchangeRates;
        const controller = createController(view);

        const update = controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).toHaveBeenCalledTimes(1);
        expect(botApiService.performExchangeUpdate).toHaveBeenCalledWith('usd-book', exchangeRates);
        expect(view.executing).toBe(true);
        expect(view.results.get('usd-book')).toEqual({ status: 'WAITING' });

        resolveUpdate([
            {
                amount: '12.345',
                description: '#exchange_loss',
                debitAccount: { name: 'Cash EXC' },
            },
            {
                amount: '2.345',
                description: '#exchange_gain',
                creditAccount: { name: 'Cash EXC' },
            },
        ]);
        await update;

        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: '{"Cash EXC":"10.00"}',
        });
        expect(view.executing).toBe(false);
    });

    it('keeps successful and failed per-Book results without retrying a mutation', async () => {
        botApiService.performExchangeUpdate = mock(async bookId => {
            if (bookId === 'eur-book') {
                throw new Error('EUR update failed');
            }
            return [];
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [
            { id: 'usd-book', code: 'USD', isBase: true, fractionDigits: 2 },
            { id: 'eur-book', code: 'EUR', isBase: true, fractionDigits: 2 },
        ];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { EUR: 0.8 },
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).toHaveBeenCalledTimes(2);
        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: '{}',
        });
        expect(view.results.get('eur-book')).toEqual({
            status: 'ERROR',
            error: 'EUR update failed',
        });
        expect(view.executing).toBe(false);
    });

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

    it('clears results after rates for a new date load successfully', async () => {
        const exchangeRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-07',
            rates: { BRL: 5.5 },
        };
        botApiService.loadExchangeRates = async () => exchangeRates;
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = exchangeRates.date;
        view.results.set('book-id', {
            status: 'COMPLETE',
            summary: '{"Cash EXC":"10.00"}',
        });
        const controller = createController(view);

        await controller.loadRates();

        expect(view.exchangeRates).toBe(exchangeRates);
        expect(view.results.size).toBe(0);
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
