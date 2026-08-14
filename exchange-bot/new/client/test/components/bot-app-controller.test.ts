import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { App, Book, Permission } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController, BotAppState } from '../../src/components/bot-app-controller.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
import type { AppError, ExchangeBotBook } from '../../src/types.js';
import { BotAppErrors } from '../../src/components/bot-app-errors.js';
import { authService } from '../../src/services/auth-service.js';
import { bkperService } from '../../src/services/bkper-service.js';
import { botService } from '../../src/services/bot-service.js';

class TestView implements ReactiveControllerHost {
    appState = BotAppState.LOADING;
    app?: App;
    book?: Book;
    bookId = '';
    initialDate = '';
    error?: AppError;
    embedded = false;
    books: ExchangeBotBook[] = [];
    hasViewerPermission = false;
    hasEditorPermission = false;
    warnings: string[] = [];
    validating = false;
    validationError = '';
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
const originalLoadGlobalApp = bkperService.loadApp;
const originalLoadBook = bkperService.loadBook;
const originalLoadApp = bkperService.loadInstalledApp;
const originalGetConnectedBooks = botService.getConnectedBooks;
const originalGetVisibleCollectionExcCodes = botService.getCollectionExcCodes;
const originalGetBookConfiguredExcCodes = botService.getBookConfiguredExcCodes;
const originalGetBooksWithPendingTasks = botService.getBooksWithPendingTasks;
const originalGetBooksWithEventErrors = botService.getBooksWithEventErrors;
const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');
const originalTop = Object.getOwnPropertyDescriptor(self, 'top');

beforeEach(() => {
    Object.defineProperty(self, 'location', {
        configurable: true,
        value: { href: 'https://exchange-bot.bkper.app/?bookId=book-id' },
    });
    Object.defineProperty(self, 'top', {
        configurable: true,
        value: self,
    });
    bkperService.loadApp = async () => new App({ id: 'exchange-bot' });
    bkperService.loadInstalledApp = async () => new App({ id: 'exchange-bot' });
    botService.getConnectedBooks = async () => new Set<Book>();
    botService.getCollectionExcCodes = () => new Set<string>();
    botService.getBookConfiguredExcCodes = async () => new Set<string>();
    botService.getBooksWithPendingTasks = async () => new Set<Book>();
    botService.getBooksWithEventErrors = async () => new Set<Book>();
});

afterEach(() => {
    authService.init = originalInit;
    authService.accessToken = undefined;
    bkperService.loadApp = originalLoadGlobalApp;
    bkperService.loadBook = originalLoadBook;
    bkperService.loadInstalledApp = originalLoadApp;
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
    if (originalTop) {
        Object.defineProperty(self, 'top', originalTop);
    } else {
        Reflect.deleteProperty(self, 'top');
    }
});

function createController(view: TestView): BotAppController {
    return new BotAppController(view as unknown as BotAppView);
}

describe('Bot app controller', () => {
    it('loads App metadata even when authentication does not establish a session', async () => {
        const app = new App({ id: 'exchange-bot', name: 'Global Exchange Bot' });
        bkperService.loadApp = mock(async () => app);
        authService.init = async () => {};
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(bkperService.loadApp).toHaveBeenCalledTimes(1);
        expect(view.app).toBe(app);
    });

    it('loads App metadata in parallel with the Book context', async () => {
        const app = new App({ id: 'exchange-bot', name: 'Global Exchange Bot' });
        let resolveApp: ((app: App) => void) | undefined;
        bkperService.loadApp = () =>
            new Promise<App>(resolve => {
                resolveApp = resolve;
            });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () =>
            new Book({
                id: 'book-id',
                timeZone: 'UTC',
                permission: Permission.EDITOR,
            });
        let markBookContextLoaded: (() => void) | undefined;
        const bookContextLoaded = new Promise<void>(resolve => {
            markBookContextLoaded = resolve;
        });
        botService.getConnectedBooks = async () => {
            markBookContextLoaded?.();
            return new Set<Book>();
        };
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();
        await bookContextLoaded;

        expect(view.app).toBeUndefined();
        if (!resolveApp) {
            throw new Error('App loading did not start');
        }
        resolveApp(app);
        await initialization;
        expect(view.app).toBe(app);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('enables embedded mode when running in an iframe', async () => {
        Object.defineProperty(self, 'top', {
            configurable: true,
            value: {},
        });
        authService.init = async () => {};
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.embedded).toBe(true);
    });

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
        bkperService.loadBook = mock(async () => book);
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();

        expect(view.appState).toBe(BotAppState.LOADING);
        await initialization;
        expect(bkperService.loadBook).toHaveBeenCalledWith('book-id', true);
        expect(view.bookId).toBe('book-id');
        expect(view.book).toBe(book);
        expect(view.initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('blocks Exchange Update when Exchange Bot is not installed', async () => {
        const book = new Book({
            id: 'book-id',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        bkperService.loadInstalledApp = mock(async () => null);
        botService.getConnectedBooks = mock(async () => new Set<Book>());
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(bkperService.loadInstalledApp).toHaveBeenCalledWith(book, 'exchange-bot');
        expect(botService.getConnectedBooks).not.toHaveBeenCalled();
        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('book-id'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('shows the same blocking error when installation verification fails', async () => {
        const book = new Book({
            id: 'book-id',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        bkperService.loadInstalledApp = async () => {
            throw new Error('Apps unavailable');
        };
        botService.getConnectedBooks = mock(async () => new Set<Book>());
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(botService.getConnectedBooks).not.toHaveBeenCalled();
        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('book-id'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('does not initialize Exchange Update without view permission', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.RECORDER,
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        botService.getConnectedBooks = mock(async () => new Set<Book>());
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.hasViewerPermission).toBe(false);
        expect(view.error).toEqual({
            type: 'info',
            title: 'Insufficient Book permission.',
            message: {
                before: 'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.',
            },
        });
        expect(botService.getConnectedBooks).not.toHaveBeenCalled();
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('does not classify default-date failures as selected Book failures', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () =>
            new Book({
                id: 'book-id',
                timeZone: 'Invalid/Timezone',
                permission: Permission.EDITOR,
            });
        const view = new TestView();
        const controller = createController(view);

        await expect(controller.initialize()).rejects.toThrow();

        expect(view.book?.getId()).toBe('book-id');
        expect(view.initialDate).toBe('');
        expect(view.error).toBeUndefined();
    });

    it('does not classify context failures as selected Book failures', async () => {
        const book = new Book({
            id: 'book-id',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
        });
        const contextError = { status: 404, message: 'Connected Book not found' };
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        botService.getConnectedBooks = async () => {
            throw contextError;
        };
        const view = new TestView();
        const controller = createController(view);

        await expect(controller.initialize()).rejects.toBe(contextError);

        expect(view.book).toBe(book);
        expect(view.error).toBeUndefined();
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
            permission: Permission.EDITOR,
            properties: { exc_base: 'false', exc_code: 'EUR' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => selectedBook;
        botService.getConnectedBooks = async () => new Set([connectedBook, baseBook]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.books).toEqual([
            {
                book: connectedBook,
                excCode: 'BRL',
                isBase: false,
            },
            { book: baseBook, excCode: 'EUR', isBase: true },
            { book: selectedBook, excCode: 'USD', isBase: false },
        ]);
        expect(view.hasEditorPermission).toBe(true);
        expect(view.error).toBeUndefined();
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
            permission: Permission.EDITOR,
            properties: { exc_code: 'BRL' },
        });
        let configuredExcCodes = new Set(['BRL']);
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => selectedBook;
        botService.getConnectedBooks = async () => new Set([connectedBook]);
        botService.getBookConfiguredExcCodes = async () => configuredExcCodes;
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();
        expect(view.warnings.length).toBeGreaterThan(0);

        configuredExcCodes = new Set<string>();
        await controller.initialize();

        expect(view.books.map(book => book.book.getId())).toEqual(['connected-book', 'book-id']);
        expect(view.error).toBeUndefined();
        expect(view.warnings).toEqual([]);
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
                    {
                        id: 'book-id',
                        permission: Permission.EDITOR,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'collection-book',
                        permission: Permission.VIEWER,
                        properties: { exc_code: 'BRL' },
                    },
                    {
                        id: 'unconfigured-collection-book',
                        permission: Permission.VIEWER,
                        properties: {},
                    },
                ],
            },
        });
        const legacyConnectedBook = new Book({
            id: 'legacy-connected-book',
            permission: Permission.EDITOR,
            properties: { exc_code: 'EUR' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => selectedBook;
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

    it('keeps the UI available to a viewer but prevents Exchange Update', async () => {
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
        bkperService.loadBook = async () => book;
        const getConfiguredCodes = mock(async () => new Set(['BRL']));
        const getBooksWithErrors = mock(
            async () => new Set([new Book({ properties: { exc_code: 'EUR' } })])
        );
        botService.getBookConfiguredExcCodes = getConfiguredCodes;
        botService.getBooksWithPendingTasks = async () => new Set([book]);
        botService.getBooksWithEventErrors = getBooksWithErrors;
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.hasViewerPermission).toBe(true);
        expect(view.hasEditorPermission).toBe(false);
        expect(view.error).toEqual({
            type: 'error',
            message: {
                before: 'User needs EDITOR or OWNER permission in the following books: USD Book book',
            },
        });
        expect(getConfiguredCodes).toHaveBeenCalledTimes(1);
        expect(getBooksWithErrors).toHaveBeenCalledTimes(1);
        expect(view.warnings).toEqual([
            'Configured currencies do not have a visible connected Book: BRL',
            'Books with pending tasks: USD',
            'Books with errors: EUR',
        ]);
    });

    it('requires edit permission only on concrete Exchange Update targets', async () => {
        const selectedBook = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
            collection: {
                books: [{ id: 'base-book', properties: { exc_base: 'true' } }],
            },
        });
        const nonTargetBook = new Book({
            id: 'connected-book',
            permission: Permission.RECORDER,
            properties: { exc_code: 'BRL' },
        });
        const targetBook = new Book({
            id: 'base-book',
            name: 'EUR Book',
            permission: Permission.VIEWER,
            properties: { exc_base: 'true', exc_code: 'EUR' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => selectedBook;
        botService.getConnectedBooks = async () => new Set([nonTargetBook, targetBook]);
        let pendingTaskBookIds: string[] = [];
        botService.getBooksWithPendingTasks = async books => {
            pendingTaskBookIds = Array.from(books, book => book.getId());
            return new Set<Book>();
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(pendingTaskBookIds).toEqual(['base-book', 'book-id']);
        expect(view.hasEditorPermission).toBe(false);
        expect(view.error?.message.before).toContain('EDITOR or OWNER');
    });

    it('preserves pending-task validation for unconfigured legacy connections', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        const legacyConnectedBook = new Book({
            id: 'legacy-connected-book',
            permission: Permission.EDITOR,
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        botService.getConnectedBooks = async () => new Set([legacyConnectedBook]);
        botService.getBooksWithPendingTasks = async () => new Set([legacyConnectedBook]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.warnings[0]).toContain('pending tasks');
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
            permission: Permission.EDITOR,
            properties: { exc_code: 'BRL' },
        });
        const secondConnectedBook = new Book({
            id: 'second-connected-book',
            permission: Permission.EDITOR,
            properties: { exc_code: 'BRL' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        botService.getConnectedBooks = async () =>
            new Set([firstConnectedBook, secondConnectedBook]);
        botService.getBooksWithPendingTasks = async () =>
            new Set([firstConnectedBook, secondConnectedBook]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.warnings.join(' ').match(/BRL/g)).toHaveLength(1);
    });

    it('makes Exchange Update ready while connected Books are being validated', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        let resolvePendingTasks = (_books: Set<Book>): void => {};
        let resolveEventErrors = (_books: Set<Book>): void => {};
        let markPendingTasksStarted = (): void => {};
        let markEventErrorsStarted = (): void => {};
        const pendingTasksStarted = new Promise<void>(resolve => {
            markPendingTasksStarted = resolve;
        });
        const eventErrorsStarted = new Promise<void>(resolve => {
            markEventErrorsStarted = resolve;
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        botService.getBookConfiguredExcCodes = async () => new Set(['BRL']);
        botService.getBooksWithPendingTasks = async () => {
            markPendingTasksStarted();
            return new Promise<Set<Book>>(resolve => {
                resolvePendingTasks = resolve;
            });
        };
        const getBooksWithErrors = mock(async () => {
            markEventErrorsStarted();
            return new Promise<Set<Book>>(resolve => {
                resolveEventErrors = resolve;
            });
        });
        botService.getBooksWithEventErrors = getBooksWithErrors;
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();
        await pendingTasksStarted;

        expect(view.appState).toBe(BotAppState.READY);
        expect(view.validating).toBe(true);
        expect(view.warnings).toEqual([
            'Configured currencies do not have a visible connected Book: BRL',
        ]);
        expect(getBooksWithErrors).not.toHaveBeenCalled();

        resolvePendingTasks(new Set([book]));
        await eventErrorsStarted;

        expect(view.validating).toBe(true);
        expect(view.warnings).toEqual([
            'Configured currencies do not have a visible connected Book: BRL',
            'Books with pending tasks: USD',
        ]);

        resolveEventErrors(new Set([new Book({ properties: { exc_code: 'EUR' } })]));
        await initialization;

        expect(view.validating).toBe(false);
        expect(view.warnings).toEqual([
            'Configured currencies do not have a visible connected Book: BRL',
            'Books with pending tasks: USD',
            'Books with errors: EUR',
        ]);
    });

    it('preserves partial warnings after a validation error and retries from a clean state', async () => {
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            properties: { exc_code: 'USD' },
        });
        let configuredExcCodes = new Set(['BRL']);
        let eventErrorAttempts = 0;
        let markRetryPendingTasksStarted = (): void => {};
        let resolveRetryPendingTasks = (_books: Set<Book>): void => {};
        const retryPendingTasksStarted = new Promise<void>(resolve => {
            markRetryPendingTasksStarted = resolve;
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => book;
        botService.getBookConfiguredExcCodes = async () => configuredExcCodes;
        botService.getBooksWithPendingTasks = async () => new Set([book]);
        botService.getBooksWithEventErrors = async () => {
            eventErrorAttempts++;
            if (eventErrorAttempts === 1) {
                throw new Error('Events unavailable');
            }
            return new Set<Book>();
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.validating).toBe(false);
        expect(view.validationError).toBe('An error occurred while validating connected Books.');
        expect(view.warnings).toEqual([
            'Configured currencies do not have a visible connected Book: BRL',
            'Books with pending tasks: USD',
        ]);

        configuredExcCodes = new Set<string>();
        botService.getBooksWithPendingTasks = async () => {
            markRetryPendingTasksStarted();
            return new Promise<Set<Book>>(resolve => {
                resolveRetryPendingTasks = resolve;
            });
        };

        const retry = controller.retryValidations();
        await retryPendingTasksStarted;

        expect(view.validating).toBe(true);
        expect(view.validationError).toBe('');
        expect(view.warnings).toEqual([]);

        resolveRetryPendingTasks(new Set<Book>());
        await retry;

        expect(view.validating).toBe(false);
        expect(view.validationError).toBe('');
        expect(view.warnings).toEqual([]);
    });

    it('shows all non-blocking context warnings in order', async () => {
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
        bkperService.loadBook = async () => book;
        botService.getCollectionExcCodes = () => new Set(['USD']);
        botService.getBookConfiguredExcCodes = async () => new Set(['BRL']);
        botService.getBooksWithPendingTasks = async () => new Set([book]);
        botService.getBooksWithEventErrors = async () =>
            new Set([new Book({ properties: { exc_code: 'EUR' } })]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.hasEditorPermission).toBe(true);
        expect(view.error).toBeUndefined();
        expect(view.warnings).toEqual([
            'Configured currencies do not have a visible connected Book: BRL',
            'Books with pending tasks: USD',
            'Books with errors: EUR',
        ]);
    });

    it('shows pending-task and bot-error warnings together', async () => {
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
        bkperService.loadBook = async () => book;
        botService.getBooksWithPendingTasks = async () => new Set([book]);
        botService.getBooksWithEventErrors = async () =>
            new Set([new Book({ properties: { exc_code: 'BRL' } })]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.error).toBeUndefined();
        expect(view.warnings).toEqual(['Books with pending tasks: USD', 'Books with errors: BRL']);
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
        bkperService.loadBook = async () => book;
        botService.getBooksWithEventErrors = async () =>
            new Set([
                new Book({ properties: { exc_code: 'BRL' } }),
                new Book({ properties: { exc_code: 'EUR' } }),
            ]);
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.error).toBeUndefined();
        expect(view.warnings).toEqual(['Books with errors: BRL, EUR']);
    });

    it('shows an error without loading a Book when bookId is missing', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://exchange-bot.bkper.app/' },
        });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = mock(async () => new Book());
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(bkperService.loadBook).not.toHaveBeenCalled();
        expect(view.error).toEqual(BotAppErrors.bookNotSpecified());
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('offers the Book access flow when the user is not a collaborator', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => {
            throw {
                status: 401,
                message:
                    'The user [user@example.com] is not a collaborator on the book [USD Book - book-id]',
            };
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.bookId).toBe('book-id');
        expect(view.error).toEqual({
            type: 'info',
            title: "You don't have access to this Book.",
            message: {
                action: {
                    label: 'Request access',
                    url: 'https://bkper.app/books/book-id/transactions',
                },
                after: 'in Bkper to continue.',
            },
        });
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('shows the Book link error when the selected Book is not found', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => {
            throw { status: 404, message: 'Book not found' };
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.error).toEqual(BotAppErrors.bookNotFound());
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('shows a retryable message when the selected Book cannot be loaded', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bkperService.loadBook = async () => {
            throw new Error('Book unavailable');
        };
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.error).toEqual(BotAppErrors.bookLoadFailed());
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
