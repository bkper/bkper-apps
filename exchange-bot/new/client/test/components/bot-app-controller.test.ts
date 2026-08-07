import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ExchangeRates } from '../../src/api/generated/types.js';
import { BotAppController, BotAppState } from '../../src/components/bot-app-controller.js';
import type { BotAppView, BotAppBook } from '../../src/components/bot-app-view.js';
import { authService } from '../../src/services/auth-service.js';
import { botApiService } from '../../src/services/bot-api-service.js';
import { bookService } from '../../src/services/book-service.js';
import { botService } from '../../src/services/bot-service.js';

class TestView implements ReactiveControllerHost {
    appState = BotAppState.LOADING;
    book?: Book;
    date = '';
    error = '';
    exchangeRates?: ExchangeRates;
    ratesLoading = false;
    ratesError = '';
    books: BotAppBook[] = [];
    basePermissionGranted = false;
    permissionGranted = false;
    permissionError = '';
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

const originalInit = authService.init;
const originalLoadBook = bookService.loadBook;
const originalLoadRates = botApiService.loadExchangeRates;
const originalGetConnectedBooks = botService.getConnectedBooks;
const originalGetVisibleCollectionExcCodes = botService.getCollectionExcCodes;
const originalGetBookConfiguredExcCodes = botService.getBookConfiguredExcCodes;
const originalGetBooksWithPendingTasks = botService.getBooksWithPendingTasks;
const originalGetBooksWithEventErrors = botService.getBooksWithEventErrors;
const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');

beforeEach(() => {
    Object.defineProperty(self, 'location', {
        configurable: true,
        value: { href: 'https://exchange-bot.bkper.app/?bookId=book-id' },
    });
    botService.getConnectedBooks = async () => new Set<Book>();
    botService.getCollectionExcCodes = () => new Set<string>();
    botService.getBookConfiguredExcCodes = async () => new Set<string>();
    botService.getBooksWithPendingTasks = async () => new Set<Book>();
    botService.getBooksWithEventErrors = async () => new Set<Book>();
});

afterEach(() => {
    authService.init = originalInit;
    authService.accessToken = undefined;
    bookService.loadBook = originalLoadBook;
    botApiService.loadExchangeRates = originalLoadRates;
    botService.getConnectedBooks = originalGetConnectedBooks;
    botService.getCollectionExcCodes = originalGetVisibleCollectionExcCodes;
    botService.getBookConfiguredExcCodes = originalGetBookConfiguredExcCodes;
    botService.getBooksWithPendingTasks = originalGetBooksWithPendingTasks;
    botService.getBooksWithEventErrors = originalGetBooksWithEventErrors;
    if (originalLocation) {
        Object.defineProperty(self, 'location', originalLocation);
    } else {
        Reflect.deleteProperty(self, 'location');
    }
});

function createController(view: TestView): BotAppController {
    return new BotAppController(view as unknown as BotAppView);
}

describe('Bot app controller', () => {
    it('loads the selected Book after authentication succeeds', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'America/New_York',
            permission: Permission.EDITOR,
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        const exchangeRates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: 5.4 },
        };
        bookService.loadBook = mock(async () => book);
        botApiService.loadExchangeRates = mock(async () => exchangeRates);
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();

        expect(view.appState).toBe(BotAppState.LOADING);
        await initialization;
        expect(bookService.loadBook).toHaveBeenCalledWith('book-id');
        expect(view.book).toBe(book);
        expect(view.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(botApiService.loadExchangeRates).toHaveBeenCalledWith('book-id', view.date);
        expect(view.exchangeRates).toBe(exchangeRates);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('loads connected Books and preserves base-Book eligibility', async () => {
        const selectedBook = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
            collection: {
                books: [{ id: 'base-book', properties: { exc_base: 'false' } }],
            },
        });
        const connectedBook = new Book({
            id: 'connected-book',
            name: 'BRL Book',
            properties: { exc_code: 'BRL' },
        });
        const baseBook = new Book({
            id: 'base-book',
            name: 'EUR Book',
            properties: { exc_base: 'false', exc_code: 'EUR' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => selectedBook;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getConnectedBooks = async () => new Set([connectedBook, baseBook]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.books).toEqual([
            {
                id: 'connected-book',
                code: 'BRL',
                base: false,
            },
            { id: 'base-book', code: 'EUR', base: true },
            { id: 'book-id', code: 'USD', base: false },
        ]);
        expect(view.basePermissionGranted).toBe(true);
        expect(view.permissionGranted).toBe(true);
        expect(view.permissionError).toBe('');
    });

    it('rebuilds context without retaining Books or warnings from a previous initialization', async () => {
        const selectedBook = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        const connectedBook = new Book({
            id: 'connected-book',
            properties: { exc_code: 'BRL' },
        });
        let configuredExcCodes = new Set(['BRL']);
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => selectedBook;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getConnectedBooks = async () => new Set([connectedBook]);
        botService.getBookConfiguredExcCodes = async () => configuredExcCodes;
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();
        expect(view.permissionError).not.toBe('');

        configuredExcCodes = new Set<string>();
        await controller.initialize();

        expect(view.books.map(book => book.id)).toEqual(['connected-book', 'book-id']);
        expect(view.permissionGranted).toBe(true);
        expect(view.permissionError).toBe('');
    });

    it('checks event errors only in Collection Books', async () => {
        const selectedBook = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
            collection: {
                books: [
                    { id: 'book-id', properties: { exc_code: 'USD' } },
                    { id: 'collection-book', properties: { exc_code: 'BRL' } },
                    { id: 'unconfigured-collection-book', properties: {} },
                ],
            },
        });
        const legacyConnectedBook = new Book({
            id: 'legacy-connected-book',
            properties: { exc_code: 'EUR' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => selectedBook;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getConnectedBooks = async () => new Set([legacyConnectedBook]);
        let checkedBookIds: string[] = [];
        botService.getBooksWithEventErrors = async books => {
            checkedBookIds = Array.from(books, book => book.getId());
            return new Set<Book>();
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(checkedBookIds).toEqual(['book-id', 'collection-book']);
    });

    it('preserves the selected Book edit-permission early return', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.VIEWER,
            properties: { exc_code: 'USD' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        const loadRates = mock(async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        }));
        botApiService.loadExchangeRates = loadRates;
        const getConfiguredCodes = mock(async () => new Set<string>());
        const getBooksWithErrors = mock(async () => new Set<Book>());
        botService.getBookConfiguredExcCodes = getConfiguredCodes;
        botService.getBooksWithEventErrors = getBooksWithErrors;
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.basePermissionGranted).toBe(false);
        expect(view.permissionGranted).toBe(false);
        expect(view.permissionError).toBe('User needs EDITOR or OWNER permission in USD Book book');
        expect(getConfiguredCodes).not.toHaveBeenCalled();
        expect(getBooksWithErrors).not.toHaveBeenCalled();
        expect(loadRates).toHaveBeenCalledTimes(1);
    });

    it('preserves pending-task validation for unconfigured legacy connections', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        const legacyConnectedBook = new Book({ id: 'legacy-connected-book' });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getConnectedBooks = async () => new Set([legacyConnectedBook]);
        botService.getBooksWithPendingTasks = async () => new Set([legacyConnectedBook]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.permissionGranted).toBe(false);
        expect(view.permissionError).toContain('pending bot tasks');
    });

    it('deduplicates pending-task exchange codes', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        const firstConnectedBook = new Book({
            id: 'first-connected-book',
            properties: { exc_code: 'BRL' },
        });
        const secondConnectedBook = new Book({
            id: 'second-connected-book',
            properties: { exc_code: 'BRL' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getConnectedBooks = async () =>
            new Set([firstConnectedBook, secondConnectedBook]);
        botService.getBooksWithPendingTasks = async () =>
            new Set([firstConnectedBook, secondConnectedBook]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.permissionError.match(/BRL/g)).toHaveLength(1);
    });

    it('shows missing connected-Book permission before pending tasks and bot errors', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getCollectionExcCodes = () => new Set(['USD']);
        botService.getBookConfiguredExcCodes = async () => new Set(['BRL']);
        botService.getBooksWithPendingTasks = async () => new Set([book]);
        botService.getBooksWithEventErrors = async () =>
            new Set([new Book({ properties: { exc_code: 'EUR' } })]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.basePermissionGranted).toBe(true);
        expect(view.permissionGranted).toBe(false);
        expect(view.permissionError).toBe('User needs permission in BRL book');
    });

    it('shows pending tasks before bot errors', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getBooksWithPendingTasks = async () => new Set([book]);
        botService.getBooksWithEventErrors = async () =>
            new Set([new Book({ properties: { exc_code: 'BRL' } })]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.permissionGranted).toBe(false);
        expect(view.permissionError).toBe('There are pending bot tasks in USD book');
    });

    it('shows bot errors after permission and pending-task checks pass', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        botApiService.loadExchangeRates = async () => ({
            base: 'USD',
            date: '2026-08-06',
            rates: {},
        });
        botService.getBooksWithEventErrors = async () =>
            new Set([
                new Book({ properties: { exc_code: 'BRL' } }),
                new Book({ properties: { exc_code: 'EUR' } }),
            ]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.permissionGranted).toBe(false);
        expect(view.permissionError).toBe('There are bot errors in BRL, EUR books');
    });

    it('keeps the Book and date visible when rates cannot be loaded', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => book;
        botApiService.loadExchangeRates = async () => {
            throw new Error('Rates unavailable');
        };
        const view = new TestView();
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
        expect(view.appState).toBe(BotAppState.READY);
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

    it('shows an error without loading a Book when bookId is missing', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://exchange-bot.bkper.app/' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = mock(async () => new Book());
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(bookService.loadBook).not.toHaveBeenCalled();
        expect(view.error).not.toBe('');
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('shows an error when the selected Book cannot be loaded', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () => {
            throw new Error('Book unavailable');
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.error).not.toBe('');
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('stays loading when authentication does not establish a session', async () => {
        authService.init = async () => {};
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.appState).toBe(BotAppState.LOADING);
    });

    it('starts initialization when the view connects', async () => {
        authService.init = mock(async () => {});
        const view = new TestView();
        const controller = createController(view);

        controller.hostConnected();
        await Promise.resolve();

        expect(authService.init).toHaveBeenCalledTimes(1);
    });
});
