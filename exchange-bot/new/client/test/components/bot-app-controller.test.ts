import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController, BotAppState } from '../../src/components/bot-app-controller.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
import type { BotAppBook } from '../../src/components/exchange-update/exchange-update-view.js';
import { authService } from '../../src/services/auth-service.js';
import { bookService } from '../../src/services/book-service.js';
import { botService } from '../../src/services/bot-service.js';

class TestView implements ReactiveControllerHost {
    appState = BotAppState.LOADING;
    book?: Book;
    initialDate = '';
    error = '';
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
        bookService.loadBook = mock(async () => book);
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();

        expect(view.appState).toBe(BotAppState.LOADING);
        await initialization;
        expect(bookService.loadBook).toHaveBeenCalledWith('book-id');
        expect(view.book).toBe(book);
        expect(view.initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('keeps default-date failures in the outer initialization error boundary', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = async () =>
            new Book({
                id: 'book-id',
                timeZone: 'Invalid/Timezone',
                permission: Permission.EDITOR,
            });
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.initialDate).toBe('');
        expect(view.error).not.toBe('');
        expect(view.appState).toBe(BotAppState.ERROR);
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
