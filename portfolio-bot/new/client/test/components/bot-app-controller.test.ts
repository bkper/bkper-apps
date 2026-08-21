import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AccountType, App, Book, Permission, type Account, type Group } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController, BotAppState } from '../../src/components/bot-app-controller.js';
import { BotAppErrors } from '../../src/components/bot-app-errors.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
import { authService } from '../../src/services/auth-service.js';
import { bkperService } from '../../src/services/bkper-service.js';
import { botApiService } from '../../src/services/bot-api-service.js';
import { botService } from '../../src/services/bot-service.js';
import type { AppError, PortfolioBotBook } from '../../src/types.js';

class TestView implements ReactiveControllerHost {
    appState = BotAppState.LOADING;
    app?: App;
    portfolioBook?: Book;
    accounts: Account[] = [];
    group?: Group;
    enableReset = false;
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
const originalListAccountsPendingCalculation = botApiService.listAccountsPendingCalculation;
const originalGetStockBook = botService.getStockBook;
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
    botApiService.listAccountsPendingCalculation = mock(async () => ({ ids: [] }));
    botService.getStockBook = mock(book => book);
});

afterEach(() => {
    authService.init = originalAuthInit;
    authService.accessToken = undefined;
    bkperService.loadApp = originalLoadApp;
    bkperService.loadBook = originalLoadBook;
    bkperService.loadInstalledApp = originalLoadInstalledApp;
    botApiService.listAccountsPendingCalculation = originalListAccountsPendingCalculation;
    botService.getStockBook = originalGetStockBook;
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

const loadAccount = Reflect.get(BotAppController.prototype, 'loadAccount') as (
    this: BotAppController,
    book: Book,
    portfolioBook: Book
) => Promise<Account | null | undefined>;

const loadGroup = Reflect.get(BotAppController.prototype, 'loadGroup') as (
    this: BotAppController,
    book: Book,
    portfolioBook: Book
) => Promise<Group | null | undefined>;

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

        expect(bkperService.loadBook).toHaveBeenCalledTimes(1);
        expect(bkperService.loadBook).toHaveBeenCalledWith('book-id', true);
        expect(bkperService.loadInstalledApp).toHaveBeenCalledWith(book, 'stock-bot');
        expect(view.portfolioBook).toBe(book);
        expect(view.initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(view.hasViewerPermission).toBe(true);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('loads the Portfolio Book and resolves the legacy Account context', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://stock-bot.bkper.app/?bookId=financial-book&accountId=source-account&groupId=source-group',
            },
        });
        const financialBook = new Book({
            id: 'financial-book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            groups: [{ id: 'source-group', name: 'Technology' }],
            accounts: [
                {
                    id: 'source-account',
                    name: 'Apple',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'source-group' }],
                },
            ],
        });
        const portfolioCandidate = new Book({ id: 'portfolio-book', fractionDigits: 0 });
        const portfolioBook = new Book({
            id: 'portfolio-book',
            fractionDigits: 0,
            permission: Permission.VIEWER,
            groups: [
                {
                    id: 'exchange-group',
                    name: 'NASDAQ',
                    properties: { stock_exc_code: 'USD' },
                },
            ],
            accounts: [
                {
                    id: 'portfolio-account',
                    name: 'Apple',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'exchange-group' }],
                },
            ],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? financialBook : portfolioBook
        );
        botService.getStockBook = mock(() => portfolioCandidate);
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadBook).toHaveBeenNthCalledWith(1, 'financial-book', true);
        expect(bkperService.loadBook).toHaveBeenNthCalledWith(2, 'portfolio-book', true);
        expect(view.portfolioBook).toBe(portfolioBook);
        expect(view.accounts.map(account => account.getId())).toEqual(['portfolio-account']);
        expect(view.group).toBeUndefined();
        expect(view.enableReset).toBe(true);
        expect(botApiService.listAccountsPendingCalculation).not.toHaveBeenCalled();
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('maps a Group selection and keeps only eligible Portfolio Accounts', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://stock-bot.bkper.app/?bookId=financial-book&groupId=source-group',
            },
        });
        const financialBook = new Book({
            id: 'financial-book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
            groups: [{ id: 'source-group', name: 'Technology' }],
        });
        const portfolioBook = new Book({
            id: 'portfolio-book',
            fractionDigits: 0,
            permission: Permission.VIEWER,
            groups: [
                { id: 'portfolio-group', name: 'Technology' },
                {
                    id: 'exchange-group',
                    name: 'NASDAQ',
                    properties: { stock_exc_code: 'USD' },
                },
            ],
            accounts: [
                {
                    id: 'apple',
                    name: 'Apple',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'portfolio-group' }, { id: 'exchange-group' }],
                },
                {
                    id: 'alphabet',
                    name: 'Alphabet',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'portfolio-group' }, { id: 'exchange-group' }],
                },
                {
                    id: 'archived',
                    name: 'Archived',
                    type: AccountType.ASSET,
                    permanent: true,
                    archived: true,
                    groups: [{ id: 'portfolio-group' }, { id: 'exchange-group' }],
                },
                {
                    id: 'missing-exchange',
                    name: 'Missing Exchange',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'portfolio-group' }],
                },
            ],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? financialBook : portfolioBook
        );
        botService.getStockBook = mock(() => new Book({ id: 'portfolio-book' }));
        const view = new TestView();

        await createController(view).initialize();

        expect(view.accounts.map(account => account.getId())).toEqual(['alphabet', 'apple']);
        expect(view.group).toBe(await portfolioBook.getGroup('portfolio-group'));
        expect(view.enableReset).toBe(true);
        expect(botApiService.listAccountsPendingCalculation).not.toHaveBeenCalled();
    });

    it('loads pending-calculation Accounts without selected context', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/?bookId=financial-book' },
        });
        const financialBook = new Book({
            id: 'financial-book',
            timeZone: 'UTC',
            permission: Permission.EDITOR,
        });
        const portfolioBook = new Book({
            id: 'portfolio-book',
            fractionDigits: 0,
            permission: Permission.VIEWER,
            groups: [
                {
                    id: 'exchange-group',
                    properties: { stock_exc_code: 'USD' },
                },
            ],
            accounts: [
                {
                    id: 'apple',
                    name: 'Apple',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'exchange-group' }],
                },
                {
                    id: 'alphabet',
                    name: 'Alphabet',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'exchange-group' }],
                },
                {
                    id: 'archived',
                    name: 'Archived',
                    type: AccountType.ASSET,
                    permanent: true,
                    archived: true,
                    groups: [{ id: 'exchange-group' }],
                },
            ],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? financialBook : portfolioBook
        );
        botService.getStockBook = mock(() => new Book({ id: 'portfolio-book' }));
        botApiService.listAccountsPendingCalculation = mock(async bookId => {
            expect(bookId).toBe('portfolio-book');
            return { ids: ['apple', 'archived', 'alphabet'] };
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.accounts.map(account => account.getId())).toEqual(['alphabet', 'apple']);
        expect(view.group).toBeUndefined();
        expect(view.enableReset).toBe(false);
        expect(botApiService.listAccountsPendingCalculation).toHaveBeenCalledTimes(1);
    });

    it('shows an error when the Collection has no Portfolio Book', async () => {
        botService.getStockBook = mock(() => null);
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(
            BotAppErrors.bookNotFound(
                'Portfolio Book',
                "No Portfolio Book was found in the selected Book's Collection."
            )
        );
        expect(view.appState).toBe(BotAppState.ERROR);
        expect(botApiService.listAccountsPendingCalculation).not.toHaveBeenCalled();
        expect(view.portfolioBook).toBeUndefined();
    });

    it('blocks initialization when Portfolio Bot is not installed', async () => {
        bkperService.loadInstalledApp = mock(async () => null);
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('book-id'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('requires Portfolio Bot to be installed in the selected Book', async () => {
        const selectedBook = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
        });
        const portfolioBook = new Book({
            id: 'portfolio-book',
            permission: Permission.VIEWER,
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? selectedBook : portfolioBook
        );
        botService.getStockBook = mock(() => new Book({ id: 'portfolio-book' }));
        bkperService.loadInstalledApp = mock(async book =>
            book.getId() === 'portfolio-book' ? new App({ id: 'stock-bot' }) : null
        );
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadInstalledApp).toHaveBeenCalledWith(selectedBook, 'stock-bot');
        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('financial-book'));
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('requires Portfolio Bot to be installed in a distinct Portfolio Book', async () => {
        const selectedBook = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
        });
        const portfolioBook = new Book({
            id: 'portfolio-book',
            permission: Permission.VIEWER,
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? selectedBook : portfolioBook
        );
        botService.getStockBook = mock(() => new Book({ id: 'portfolio-book' }));
        bkperService.loadInstalledApp = mock(async book =>
            book.getId() === 'financial-book' ? new App({ id: 'stock-bot' }) : null
        );
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadInstalledApp).toHaveBeenNthCalledWith(1, selectedBook, 'stock-bot');
        expect(bkperService.loadInstalledApp).toHaveBeenNthCalledWith(
            2,
            portfolioBook,
            'stock-bot'
        );
        expect(view.error).toEqual(BotAppErrors.appInstallationNotVerified('portfolio-book'));
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
        expect(view.appState).toBe(BotAppState.ERROR);
    });

    it('stops after resolving a Portfolio Book without view permission', async () => {
        const selectedBook = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
        });
        const portfolioCandidate = new Book({ id: 'portfolio-book', fractionDigits: 0 });
        const portfolioBook = new Book({
            id: 'portfolio-book',
            permission: Permission.RECORDER,
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? selectedBook : portfolioBook
        );
        botService.getStockBook = mock(() => portfolioCandidate);
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadBook).toHaveBeenNthCalledWith(1, 'financial-book', true);
        expect(bkperService.loadBook).toHaveBeenNthCalledWith(2, 'portfolio-book', true);
        expect(view.portfolioBook).toBe(portfolioBook);
        expect(view.hasViewerPermission).toBe(false);
        expect(view.error?.title).toBe('Insufficient Portfolio Book permission.');
        expect(bkperService.loadInstalledApp).toHaveBeenCalledWith(selectedBook, 'stock-bot');
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('offers access to the resolved Portfolio Book when it cannot be loaded', async () => {
        const selectedBook = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
        });
        bkperService.loadBook = mock(async bookId => {
            if (bookId === 'financial-book') {
                return selectedBook;
            }
            throw {
                status: 401,
                message: 'The user is not a collaborator on the book',
            };
        });
        botService.getStockBook = mock(() => new Book({ id: 'portfolio-book' }));
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error).toEqual(
            BotAppErrors.bookAccessRequired('portfolio-book', 'the Portfolio Book')
        );
        expect(bkperService.loadInstalledApp).toHaveBeenCalledWith(selectedBook, 'stock-bot');
        expect(view.appState).toBe(BotAppState.ERROR);
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

        expect(bkperService.loadBook).toHaveBeenCalledWith('book-id', true);
        expect(view.portfolioBook).toBeUndefined();
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

    it('distinguishes Account not-found and loading failures', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://stock-bot.bkper.app/?bookId=source-book&accountId=account-id',
            },
        });
        const portfolioBook = new Book({ id: 'portfolio-book', name: 'Portfolio Book' });

        const missingBook = new Book({ id: 'source-book', name: 'Source Book' });
        missingBook.getAccount = async () => {
            throw { status: 404, message: 'Account not found' };
        };
        const missingView = new TestView();
        expect(
            await loadAccount.call(createController(missingView), missingBook, portfolioBook)
        ).toBe(null);
        expect(missingView.error).toEqual(
            BotAppErrors.accountNotFound('account-id', 'Source Book')
        );

        const sourceBook = new Book({
            id: 'source-book',
            name: 'Source Book',
            accounts: [{ id: 'account-id', name: 'Apple' }],
        });
        const sourceAccount = await sourceBook.getAccount('account-id');
        sourceBook.getAccount = async () => sourceAccount;
        portfolioBook.getAccount = async () => {
            throw { status: 500, message: 'Unavailable' };
        };
        const failedView = new TestView();
        expect(
            await loadAccount.call(createController(failedView), sourceBook, portfolioBook)
        ).toBe(null);
        expect(failedView.error).toEqual(BotAppErrors.accountLoadFailed('Apple', 'Portfolio Book'));
    });

    it('distinguishes Group not-found and loading failures', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://stock-bot.bkper.app/?bookId=source-book&groupId=group-id',
            },
        });
        const portfolioBook = new Book({ id: 'portfolio-book', name: 'Portfolio Book' });

        const missingBook = new Book({ id: 'source-book', name: 'Source Book' });
        missingBook.getGroup = async () => {
            throw { status: 404, message: 'Group not found' };
        };
        const missingView = new TestView();
        expect(
            await loadGroup.call(createController(missingView), missingBook, portfolioBook)
        ).toBe(null);
        expect(missingView.error).toEqual(BotAppErrors.groupNotFound('group-id', 'Source Book'));

        const sourceBook = new Book({
            id: 'source-book',
            name: 'Source Book',
            groups: [{ id: 'group-id', name: 'Technology' }],
        });
        const sourceGroup = await sourceBook.getGroup('group-id');
        sourceBook.getGroup = async () => sourceGroup;
        portfolioBook.getGroup = async () => {
            throw { status: 500, message: 'Unavailable' };
        };
        const failedView = new TestView();
        expect(await loadGroup.call(createController(failedView), sourceBook, portfolioBook)).toBe(
            null
        );
        expect(failedView.error).toEqual(
            BotAppErrors.groupLoadFailed('Technology', 'Portfolio Book')
        );
    });

    it('clears the previous Book context when reinitializing', async () => {
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();
        expect(view.portfolioBook?.getId()).toBe('book-id');

        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/' },
        });
        await controller.initialize();

        expect(view.portfolioBook).toBeUndefined();
        expect(view.error).toEqual(BotAppErrors.bookNotSpecified());

        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://stock-bot.bkper.app/?bookId=book-id' },
        });
        await controller.initialize();

        expect(view.error).toBeUndefined();
        expect(view.portfolioBook?.getId()).toBe('book-id');
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('starts initialization when the view connects', () => {
        const controller = createController(new TestView());
        controller.initialize = mock(async () => {});

        controller.hostConnected();

        expect(controller.initialize).toHaveBeenCalledTimes(1);
    });
});
