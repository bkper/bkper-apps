import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Book, DecimalSeparator, Permission } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type {
    ExchangeRates,
    ExchangeUpdateResult as ExchangeUpdateApiResult,
} from '../../../src/api/generated/types.js';
import type { ExchangeBotBook, ExchangeUpdateSummary } from '../../../src/types.js';
import { ExchangeUpdateController } from '../../../src/components/exchange-update/exchange-update-controller.js';
import type { ExchangeUpdateView } from '../../../src/components/exchange-update/exchange-update-view.js';
import { BotApiError, botApiService } from '../../../src/services/bot-api-service.js';
import { bookService } from '../../../src/services/book-service.js';

class TestView implements ReactiveControllerHost {
    book?: Book;
    date = '';
    exchangeRates?: ExchangeRates;
    ratesLoading = false;
    ratesError = '';
    books: ExchangeBotBook[] = [];
    executing = false;
    results = new Map<
        string,
        {
            status: string;
            summary?: ExchangeUpdateSummary;
            error?: string;
            retryCount?: number;
            retryLimit?: number;
        }
    >();
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
const originalLoadBook = bookService.loadBook;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
    botApiService.loadExchangeRates = originalLoadRates;
    botApiService.performExchangeUpdate = originalPerformExchangeUpdate;
    bookService.loadBook = originalLoadBook;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
});

function createController(view: TestView): ExchangeUpdateController {
    return new ExchangeUpdateController(view as unknown as ExchangeUpdateView);
}

function createExchangeBotBook(
    id: string,
    excCode: string,
    isBase: boolean,
    accounts: bkper.Account[] = [],
    permission = Permission.EDITOR
): ExchangeBotBook {
    return {
        book: new Book({
            id,
            accounts,
            decimalSeparator: DecimalSeparator.COMMA,
            fractionDigits: 2,
            permission,
        }),
        excCode,
        isBase,
    };
}

function createExchangeUpdateApiResult(
    createdTransactions: bkper.Transaction[] = [],
    createdAccounts: bkper.Account[] = []
): ExchangeUpdateApiResult {
    return { createdTransactions, createdAccounts };
}

describe('Exchange update controller', () => {
    it('does not start when a concrete target lacks edit permission', async () => {
        botApiService.performExchangeUpdate = mock(async () => createExchangeUpdateApiResult());
        const view = new TestView();
        view.books = [
            createExchangeBotBook('usd-book', 'USD', true),
            createExchangeBotBook('eur-book', 'EUR', true, [], Permission.VIEWER),
            createExchangeBotBook('brl-book', 'BRL', false, [], Permission.RECORDER),
        ];
        view.exchangeRates = { base: 'USD', date: '2026-08-06', rates: {} };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).not.toHaveBeenCalled();
        expect(view.executing).toBe(false);
    });

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
        botApiService.performExchangeUpdate = mock(async () =>
            createExchangeUpdateApiResult(await updateRequest)
        );
        const refreshedBook = new Book({
            id: 'usd-book',
            accounts: [{ id: 'cash-exchange', name: 'Cash EXC' }],
            decimalSeparator: DecimalSeparator.COMMA,
            fractionDigits: 2,
        });
        bookService.loadBook = mock(async () => refreshedBook);
        const targetBook = createExchangeBotBook('usd-book', 'USD', true);
        const audit = mock(() => undefined);
        targetBook.book.audit = audit;
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [targetBook, createExchangeBotBook('brl-book', 'BRL', false)];
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
                debitAccount: { id: 'cash-exchange' },
            },
            {
                amount: '2.345',
                description: '#exchange_gain',
                creditAccount: { id: 'cash-exchange' },
            },
        ]);
        await update;

        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: { 'Cash EXC': '10,00' },
        });
        expect(bookService.loadBook).toHaveBeenCalledWith('usd-book', true);
        expect(targetBook.book).toBe(refreshedBook);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(view.executing).toBe(false);
    });

    it('does not hydrate or audit a successful response without transactions', async () => {
        botApiService.performExchangeUpdate = mock(async () =>
            createExchangeUpdateApiResult([], [{ id: 'new-exchange', name: 'New Exchange' }])
        );
        bookService.loadBook = mock(async () => {
            throw new Error('An Account-only response should not hydrate the Book chart');
        });
        const targetBook = createExchangeBotBook('usd-book', 'USD', true);
        const audit = mock(() => undefined);
        targetBook.book.audit = audit;
        const view = new TestView();
        view.books = [targetBook];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(bookService.loadBook).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: {},
        });
    });

    it('reloads a stale Account chart before summarizing a newly created Account', async () => {
        const createdAccount: bkper.Account = {
            id: 'new-exchange',
            name: 'New Exchange',
        };
        botApiService.performExchangeUpdate = mock(async () =>
            createExchangeUpdateApiResult(
                [
                    {
                        amount: '4.2',
                        description: '#exchange_loss',
                        debitAccount: { id: 'new-exchange' },
                    },
                ],
                [createdAccount]
            )
        );
        const refreshedBook = new Book({
            id: 'usd-book',
            accounts: [createdAccount],
            decimalSeparator: DecimalSeparator.COMMA,
            fractionDigits: 2,
        });
        bookService.loadBook = mock(async () => refreshedBook);
        const exchangeBotBook = createExchangeBotBook('usd-book', 'USD', true);
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [exchangeBotBook];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(bookService.loadBook).toHaveBeenCalledWith('usd-book', true);
        expect(exchangeBotBook.book).toBe(refreshedBook);
        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: { 'New Exchange': '4,20' },
        });
    });

    it('retries only the failed Book', async () => {
        const requestedBookIds: string[] = [];
        let eurAttempts = 0;
        botApiService.performExchangeUpdate = mock(async bookId => {
            requestedBookIds.push(bookId);
            if (bookId === 'eur-book' && eurAttempts++ === 0) {
                throw new Error('EUR update failed');
            }
            return createExchangeUpdateApiResult();
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [
            createExchangeBotBook('usd-book', 'USD', true),
            createExchangeBotBook('eur-book', 'EUR', true),
        ];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { EUR: 0.8 },
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(requestedBookIds).toEqual(['usd-book', 'eur-book', 'eur-book']);
        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: {},
        });
        expect(view.results.get('eur-book')).toEqual({
            status: 'COMPLETE',
            summary: {},
        });
        expect(view.executing).toBe(false);
    });

    it('keeps independent retry counts for parallel failures', async () => {
        const attempts = new Map<string, number>();
        botApiService.performExchangeUpdate = mock(async bookId => {
            const attempt = (attempts.get(bookId) ?? 0) + 1;
            attempts.set(bookId, attempt);
            const failures = bookId === 'usd-book' ? 1 : 2;
            if (attempt <= failures) {
                throw new Error(`${bookId} update failed`);
            }
            return createExchangeUpdateApiResult();
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [
            createExchangeBotBook('usd-book', 'USD', true),
            createExchangeBotBook('eur-book', 'EUR', true),
        ];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { EUR: 0.8 },
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(attempts).toEqual(
            new Map([
                ['usd-book', 2],
                ['eur-book', 3],
            ])
        );
        expect(view.results.get('usd-book')?.status).toBe('COMPLETE');
        expect(view.results.get('eur-book')?.status).toBe('COMPLETE');
    });

    it('shows retry progress without resubmitting another in-flight Book', async () => {
        const requestedBookIds: string[] = [];
        let eurAttempts = 0;
        let resolveUsdUpdate: (transactions: bkper.Transaction[]) => void = () => {};
        const usdUpdateRequest = new Promise<bkper.Transaction[]>(resolve => {
            resolveUsdUpdate = resolve;
        });
        let resolveRetryStarted: () => void = () => {};
        const retryStarted = new Promise<void>(resolve => {
            resolveRetryStarted = resolve;
        });
        let resolveRetry: (transactions: bkper.Transaction[]) => void = () => {};
        const retryRequest = new Promise<bkper.Transaction[]>(resolve => {
            resolveRetry = resolve;
        });
        botApiService.performExchangeUpdate = mock(async bookId => {
            requestedBookIds.push(bookId);
            if (bookId === 'eur-book' && eurAttempts++ === 0) {
                throw new Error('EUR update failed');
            }
            if (bookId === 'eur-book') {
                resolveRetryStarted();
                return createExchangeUpdateApiResult(await retryRequest);
            }
            return createExchangeUpdateApiResult(await usdUpdateRequest);
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [
            createExchangeBotBook('usd-book', 'USD', true),
            createExchangeBotBook('eur-book', 'EUR', true),
        ];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { EUR: 0.8 },
        };
        const controller = createController(view);

        const update = controller.runExchangeUpdate();
        await retryStarted;

        expect(requestedBookIds).toEqual(['usd-book', 'eur-book', 'eur-book']);
        expect(view.results.get('usd-book')).toEqual({ status: 'WAITING' });
        expect(view.results.get('eur-book')).toEqual({
            status: 'RETRYING',
            retryCount: 1,
            retryLimit: 5,
        });

        resolveUsdUpdate([]);
        resolveRetry([]);
        await update;
        expect(view.results.get('eur-book')).toEqual({
            status: 'COMPLETE',
            summary: {},
        });
    });

    it('stops after five retries and exposes the final error', async () => {
        botApiService.performExchangeUpdate = mock(async () => {
            throw new Error('Update failed');
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [createExchangeBotBook('usd-book', 'USD', true)];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).toHaveBeenCalledTimes(6);
        expect(view.results.get('usd-book')).toEqual({
            status: 'ERROR',
            error: 'Update failed',
        });
        expect(view.executing).toBe(false);
    });

    it('does not retry a permission failure', async () => {
        botApiService.performExchangeUpdate = mock(async () => {
            throw new BotApiError('Insufficient Book permission', 403);
        });
        const view = new TestView();
        view.books = [createExchangeBotBook('usd-book', 'USD', true)];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).toHaveBeenCalledTimes(1);
        expect(view.results.get('usd-book')).toEqual({
            status: 'ERROR',
            error: 'Insufficient Book permission',
        });
    });

    it('does not retry an error containing the legacy non-retryable text', async () => {
        botApiService.performExchangeUpdate = mock(async () => {
            throw new Error('Account not found in USD book');
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [createExchangeBotBook('usd-book', 'USD', true)];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).toHaveBeenCalledTimes(1);
        expect(view.results.get('usd-book')).toEqual({
            status: 'ERROR',
            error: 'Account not found in USD book',
        });
    });

    it('starts each user-initiated run with a fresh retry count', async () => {
        let attempts = 0;
        botApiService.performExchangeUpdate = mock(async () => {
            attempts++;
            if (attempts % 2 === 1) {
                throw new Error('Update failed');
            }
            return createExchangeUpdateApiResult();
        });
        const view = new TestView();
        view.book = new Book({ id: 'selected-book' });
        view.books = [createExchangeBotBook('usd-book', 'USD', true)];
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        };
        const controller = createController(view);

        await controller.runExchangeUpdate();
        await controller.runExchangeUpdate();

        expect(botApiService.performExchangeUpdate).toHaveBeenCalledTimes(4);
        expect(view.results.get('usd-book')).toEqual({
            status: 'COMPLETE',
            summary: {},
        });
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
            summary: { 'Cash EXC': '10.00' },
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

    it('invalidates an in-flight response as soon as another date is entered', async () => {
        globalThis.setTimeout = (() =>
            1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
        let resolveOldRates: (rates: ExchangeRates) => void = () => {};
        const oldRequest = new Promise<ExchangeRates>(resolve => {
            resolveOldRates = resolve;
        });
        botApiService.loadExchangeRates = mock(() => oldRequest);
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = '2026-08-05';
        const controller = createController(view);

        const firstRequest = controller.loadRates();
        view.date = '2026-08-06';
        controller.scheduleRatesLoad();
        resolveOldRates({ base: 'USD', date: '2026-08-05', rates: { BRL: 5.3 } });
        await firstRequest;

        expect(view.exchangeRates).toBeUndefined();
        expect(view.ratesLoading).toBe(false);
    });

    it('debounces rate loading for 1500 milliseconds and uses the latest date', async () => {
        const callbacks: TimerHandler[] = [];
        const delays: number[] = [];
        const clearTimeout = mock((_timeoutId: ReturnType<typeof setTimeout>) => undefined);
        globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
            callbacks.push(handler);
            delays.push(timeout ?? 0);
            return callbacks.length as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof setTimeout;
        globalThis.clearTimeout = clearTimeout as unknown as typeof globalThis.clearTimeout;
        botApiService.loadExchangeRates = mock(async (_bookId, date) => ({
            base: 'USD',
            date,
            rates: {},
        }));
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = '2026-08-05';
        const controller = createController(view);

        controller.scheduleRatesLoad();
        view.date = '2026-08-06';
        controller.scheduleRatesLoad();
        const latestCallback = callbacks[1];
        if (typeof latestCallback === 'function') {
            latestCallback();
        }
        await Promise.resolve();

        expect(delays).toEqual([1500, 1500]);
        expect(clearTimeout).toHaveBeenCalledTimes(1);
        expect(botApiService.loadExchangeRates).toHaveBeenCalledTimes(1);
        expect(botApiService.loadExchangeRates).toHaveBeenCalledWith('book-id', '2026-08-06');
    });

    it('loads pending rates immediately and does not reload matching rates', async () => {
        const clearTimeout = mock((_timeoutId: ReturnType<typeof setTimeout>) => undefined);
        globalThis.setTimeout = (() =>
            1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
        globalThis.clearTimeout = clearTimeout as unknown as typeof globalThis.clearTimeout;
        const exchangeRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: 5.4 },
        };
        botApiService.loadExchangeRates = mock(async () => exchangeRates);
        const view = new TestView();
        view.book = new Book({ id: 'book-id' });
        view.date = exchangeRates.date;
        const controller = createController(view);

        controller.scheduleRatesLoad();
        await controller.loadRatesImmediately();
        await controller.loadRatesImmediately();

        expect(clearTimeout).toHaveBeenCalledTimes(1);
        expect(botApiService.loadExchangeRates).toHaveBeenCalledTimes(1);
        expect(view.exchangeRates).toBe(exchangeRates);
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
