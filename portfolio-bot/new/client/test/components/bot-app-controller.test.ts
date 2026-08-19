import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { App, Book, Permission } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController, BotAppState } from '../../src/components/bot-app-controller.js';
import { BotAppErrors } from '../../src/components/bot-app-errors.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
import { authService } from '../../src/services/auth-service.js';
import { bkperService } from '../../src/services/bkper-service.js';
import type { AppError, PortfolioBotBook } from '../../src/types.js';

class TestView implements ReactiveControllerHost {
    appState = BotAppState.LOADING;
    app?: App;
    book?: Book;
    bookId = '';
    initialDate = '';
    error?: AppError;
    embedded = false;
    books: PortfolioBotBook[] = [];
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

const originalAuthInit = authService.init;
const originalLoadApp = bkperService.loadApp;
const originalLoadBook = bkperService.loadBook;
const originalLoadInstalledApp = bkperService.loadInstalledApp;
const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');
const originalTop = Object.getOwnPropertyDescriptor(self, 'top');

beforeEach(() => {
    Object.defineProperty(self, 'location', {
        configurable: true,
        value: { href: 'https://stock-bot.bkper.app/?bookId=book-id' },
    });
    Object.defineProperty(self, 'top', {
        configurable: true,
        value: self,
    });
    authService.init = async () => {
        authService.accessToken = 'access-token';
    };
    bkperService.loadApp = mock(async () => new App({ id: 'stock-bot' }));
    bkperService.loadBook = mock(
        async () =>
            new Book({
                id: 'book-id',
                timeZone: 'UTC',
                permission: Permission.EDITOR,
            })
    );
    bkperService.loadInstalledApp = mock(async () => new App({ id: 'stock-bot' }));
});

afterEach(() => {
    authService.init = originalAuthInit;
    authService.accessToken = undefined;
    bkperService.loadApp = originalLoadApp;
    bkperService.loadBook = originalLoadBook;
    bkperService.loadInstalledApp = originalLoadInstalledApp;
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
        const app = new App({ id: 'stock-bot', name: 'Global Portfolio Bot' });
        bkperService.loadApp = mock(async () => app);
        authService.init = async () => {};
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadApp).toHaveBeenCalledTimes(1);
        expect(bkperService.loadBook).not.toHaveBeenCalled();
        expect(view.app).toBe(app);
        expect(view.appState).toBe(BotAppState.LOADING);
    });

    it('loads App metadata in parallel with the Book context', async () => {
        const app = new App({ id: 'stock-bot', name: 'Global Portfolio Bot' });
        let resolveApp: ((app: App) => void) | undefined;
        bkperService.loadApp = () =>
            new Promise<App>(resolve => {
                resolveApp = resolve;
            });
        let markContextStarted: (() => void) | undefined;
        const contextStarted = new Promise<void>(resolve => {
            markContextStarted = resolve;
        });
        bkperService.loadInstalledApp = async () => {
            markContextStarted?.();
            return new App({ id: 'stock-bot' });
        };
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();
        await contextStarted;

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
        const view = new TestView();

        await createController(view).initialize();

        expect(view.embedded).toBe(true);
    });

    it('loads the selected Book and verifies the Portfolio Bot installation', async () => {
        const book = new Book({
            id: 'book-id',
            timeZone: 'America/New_York',
            permission: Permission.EDITOR,
        });
        bkperService.loadBook = mock(async () => book);
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadBook).toHaveBeenCalledWith('book-id', true);
        expect(bkperService.loadInstalledApp).toHaveBeenCalledWith(book, 'stock-bot');
        expect(view.bookId).toBe('book-id');
        expect(view.book).toBe(book);
        expect(view.initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(view.hasViewerPermission).toBe(true);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('blocks initialization when Portfolio Bot is not installed', async () => {
        bkperService.loadInstalledApp = mock(async () => null);
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('book-id'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('uses the same blocking state when installation verification fails', async () => {
        bkperService.loadInstalledApp = async () => {
            throw new Error('Apps unavailable');
        };
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('book-id'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('stops before installation verification without view permission', async () => {
        bkperService.loadBook = mock(
            async () =>
                new Book({
                    id: 'book-id',
                    timeZone: 'UTC',
                    permission: Permission.RECORDER,
                })
        );
        const view = new TestView();

        await createController(view).initialize();

        expect(view.hasViewerPermission).toBe(false);
        expect(view.error?.title).toBe('Insufficient Book permission.');
        expect(bkperService.loadInstalledApp).not.toHaveBeenCalled();
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('does not classify default-date failures as selected Book failures', async () => {
        bkperService.loadBook = mock(
            async () =>
                new Book({
                    id: 'book-id',
                    timeZone: 'Invalid/Timezone',
                    permission: Permission.EDITOR,
                })
        );
        const view = new TestView();

        await expect(createController(view).initialize()).rejects.toThrow();

        expect(view.book?.getId()).toBe('book-id');
        expect(view.initialDate).toBe('');
        expect(view.error).toBeUndefined();
    });

    it('shows an error without loading a Book when bookId is missing', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadBook).not.toHaveBeenCalled();
        expect(view.error).toEqual(BotAppErrors.bookNotSpecified());
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('offers the Book access flow when the user is not a collaborator', async () => {
        const message = 'The user is not a collaborator on the book';
        bkperService.loadBook = mock(async () => {
            throw { status: 401, message };
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(BotAppErrors.bookAccessRequired('book-id'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('shows the Book-not-found state for an unresolved Book', async () => {
        bkperService.loadBook = mock(async () => {
            throw { status: 404, message: 'Not found' };
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(BotAppErrors.bookNotFound());
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('shows a retryable state when the selected Book cannot be loaded', async () => {
        bkperService.loadBook = mock(async () => {
            throw { status: 500, message: 'Unavailable' };
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(BotAppErrors.bookLoadFailed());
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('starts initialization when the view connects', () => {
        const controller = createController(new TestView());
        controller.initialize = mock(async () => {});

        controller.hostConnected();

        expect(controller.initialize).toHaveBeenCalledTimes(1);
    });
});
