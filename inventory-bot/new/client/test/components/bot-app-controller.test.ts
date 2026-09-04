import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, AccountType, App, Book, Group, Permission } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController } from '../../src/components/bot-app-controller.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
import { authService } from '../../src/services/auth-service.js';
import { bkperService } from '../../src/services/bkper-service.js';
import { botService } from '../../src/services/bot-service.js';
import { BotAppState, type AppError, type CostOfGoodsSoldContext } from '../../src/types.js';

class TestView implements ReactiveControllerHost {
    appState = BotAppState.LOADING;
    app?: App;
    inventoryBook?: Book;
    initialDate = '';
    error?: AppError;
    embedded = false;
    cogsContext?: CostOfGoodsSoldContext;
    hasViewerPermission = false;
    hasEditorPermission = false;
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
const originalGetInventoryBook = botService.getInventoryBook;
const originalHistory = Object.getOwnPropertyDescriptor(self, 'history');
const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');
const originalParent = Object.getOwnPropertyDescriptor(self, 'parent');
const originalTop = Object.getOwnPropertyDescriptor(self, 'top');
let replaceState: ReturnType<typeof mock>;

beforeEach(() => {
    Object.defineProperty(self, 'location', {
        configurable: true,
        value: { href: 'https://inventory-bot.bkper.app/?bookId=book-id' },
    });
    Object.defineProperty(self, 'parent', {
        configurable: true,
        value: self,
    });
    Object.defineProperty(self, 'top', {
        configurable: true,
        value: self,
    });
    replaceState = mock((_state: unknown, _unused: string, url?: string | URL | null) => {
        if (url) {
            Object.defineProperty(self, 'location', {
                configurable: true,
                value: { href: new URL(url.toString(), self.location.href).href },
            });
        }
    });
    Object.defineProperty(self, 'history', {
        configurable: true,
        value: { state: null, replaceState },
    });
    authService.init = async () => {
        authService.accessToken = 'access-token';
    };
    bkperService.loadApp = mock(async () => new App({ id: 'inventory-bot' }));
    bkperService.loadBook = mock(
        async () =>
            new Book({
                id: 'book-id',
                timeZone: 'UTC',
                permission: Permission.EDITOR,
                collection: {
                    books: [{ id: 'book-id', fractionDigits: 0 }],
                },
                accounts: [],
                groups: [],
            })
    );
    bkperService.loadInstalledApp = mock(async () => new App({ id: 'inventory-bot' }));
    botService.getInventoryBook = mock(book => book);
});

afterEach(() => {
    authService.init = originalAuthInit;
    authService.accessToken = undefined;
    bkperService.loadApp = originalLoadApp;
    bkperService.loadBook = originalLoadBook;
    bkperService.loadInstalledApp = originalLoadInstalledApp;
    botService.getInventoryBook = originalGetInventoryBook;
    restoreProperty('history', originalHistory);
    restoreProperty('location', originalLocation);
    restoreProperty('parent', originalParent);
    restoreProperty('top', originalTop);
});

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) {
        Object.defineProperty(self, name, descriptor);
    } else {
        Reflect.deleteProperty(self, name);
    }
}

function createController(view: TestView): BotAppController {
    return new BotAppController(view as unknown as BotAppView);
}

function createMessage(
    data: unknown,
    origin = 'https://bkper.app',
    source: unknown = self
): MessageEvent<unknown> {
    const event = new MessageEvent<unknown>('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

function createUrlChange(url: string, origin = 'https://bkper.app'): MessageEvent<unknown> {
    return createMessage({ type: 'bkper:app-url-changed', url }, origin);
}

function handleMessage(controller: BotAppController, event: MessageEvent<unknown>): Promise<void> {
    const handler = Reflect.get(controller, 'handleMessage') as (
        event: MessageEvent<unknown>
    ) => Promise<void>;
    return handler(event);
}

const loadAccount = Reflect.get(BotAppController.prototype, 'loadAccount') as (
    this: BotAppController,
    book: Book,
    inventoryBook: Book,
    url?: URL
) => Promise<Account | null | undefined>;

const loadGroup = Reflect.get(BotAppController.prototype, 'loadGroup') as (
    this: BotAppController,
    book: Book,
    inventoryBook: Book,
    url?: URL
) => Promise<Group | null | undefined>;

describe('Bot app controller', () => {
    it('detects standalone and embedded rendering during initialization', async () => {
        const standaloneView = new TestView();
        await createController(standaloneView).initialize();
        expect(standaloneView.embedded).toBe(false);

        Object.defineProperty(self, 'top', { configurable: true, value: {} });
        const embeddedView = new TestView();
        await createController(embeddedView).initialize();
        expect(embeddedView.embedded).toBe(true);
    });

    it('loads App metadata but not Book context when authentication has no session', async () => {
        authService.init = async () => {};
        authService.accessToken = undefined;
        const view = new TestView();

        await createController(view).initialize();

        expect(view.app?.getId()).toBe('inventory-bot');
        expect(bkperService.loadBook).not.toHaveBeenCalled();
        expect(view.appState).toBe(BotAppState.LOADING);
    });

    it('authenticates and verifies installation in the originating and resolved Inventory Books', async () => {
        const originatingBook = new Book({
            id: 'financial-book',
            permission: Permission.VIEWER,
            collection: {
                books: [
                    { id: 'financial-book', fractionDigits: 2 },
                    { id: 'inventory-book', fractionDigits: 0 },
                ],
            },
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            timeZone: 'UTC',
            permission: Permission.VIEWER,
            collection: {
                books: [
                    { id: 'financial-book', fractionDigits: 2 },
                    { id: 'inventory-book', fractionDigits: 0 },
                ],
            },
            accounts: [],
            groups: [],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? originatingBook : inventoryBook
        );
        botService.getInventoryBook = mock(() => new Book({ id: 'inventory-book' }));
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://inventory-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(bkperService.loadBook).toHaveBeenNthCalledWith(1, 'financial-book', true);
        expect(bkperService.loadBook).toHaveBeenNthCalledWith(2, 'inventory-book', true);
        expect(bkperService.loadInstalledApp).toHaveBeenNthCalledWith(
            1,
            originatingBook,
            'inventory-bot'
        );
        expect(bkperService.loadInstalledApp).toHaveBeenNthCalledWith(
            2,
            inventoryBook,
            'inventory-bot'
        );
        expect(view.inventoryBook).toBe(inventoryBook);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('blocks context when either required Book installation is missing', async () => {
        const originatingBook = new Book({
            id: 'financial-book',
            permission: Permission.VIEWER,
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            permission: Permission.VIEWER,
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? originatingBook : inventoryBook
        );
        botService.getInventoryBook = mock(() => new Book({ id: 'inventory-book' }));
        bkperService.loadInstalledApp = mock(async book =>
            book.getId() === 'financial-book' ? new App({ id: 'inventory-bot' }) : null
        );
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://inventory-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.error?.title).toBe('Inventory Bot installation could not be verified.');
        expect(view.appState).toBe(BotAppState.ERROR);
        expect(view.cogsContext).toBeUndefined();
    });

    it('requires view permission on the resolved Inventory Book', async () => {
        const originatingBook = new Book({
            id: 'financial-book',
            permission: Permission.VIEWER,
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            timeZone: 'UTC',
            permission: Permission.RECORDER,
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? originatingBook : inventoryBook
        );
        botService.getInventoryBook = mock(() => new Book({ id: 'inventory-book' }));
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://inventory-bot.bkper.app/?bookId=financial-book' },
        });
        const view = new TestView();

        await createController(view).initialize();

        expect(view.inventoryBook).toBe(inventoryBook);
        expect(view.hasViewerPermission).toBe(false);
        expect(view.error?.title).toBe('Insufficient Inventory Book permission.');
        expect(view.cogsContext).toBeUndefined();
    });

    it('gives selected Account scope precedence and includes a permanent Liability Account', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://inventory-bot.bkper.app/?bookId=financial-book&accountId=source-account&groupId=source-group',
            },
        });
        const originatingBook = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
            accounts: [{ id: 'source-account', name: 'Apple' }],
            groups: [{ id: 'source-group', name: 'Products' }],
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            timeZone: 'UTC',
            permission: Permission.VIEWER,
            collection: {
                books: [
                    {
                        id: 'usd-book',
                        fractionDigits: 2,
                        permission: Permission.EDITOR,
                        properties: { exc_code: 'USD' },
                    },
                    { id: 'inventory-book', fractionDigits: 0 },
                ],
            },
            groups: [
                { id: 'source-group', name: 'Products' },
                { id: 'exchange-group', properties: { exc_code: 'USD' } },
            ],
            accounts: [
                {
                    id: 'inventory-account',
                    name: 'Apple',
                    type: AccountType.LIABILITY,
                    permanent: true,
                    archived: true,
                    groups: [{ id: 'source-group' }, { id: 'exchange-group' }],
                },
            ],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? originatingBook : inventoryBook
        );
        botService.getInventoryBook = mock(() => new Book({ id: 'inventory-book' }));
        const view = new TestView();

        await createController(view).initialize();

        expect(view.cogsContext?.selectedAccount?.getId()).toBe('inventory-account');
        expect(view.cogsContext?.selectedGroup).toBeUndefined();
        expect(view.cogsContext?.accounts.map(account => account.getId())).toEqual([
            'inventory-account',
        ]);
        expect(view.cogsContext?.resetEnabled).toBe(true);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('excludes a directly selected non-permanent Account from the operation scope', async () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://inventory-bot.bkper.app/?bookId=financial-book&accountId=source-account',
            },
        });
        const originatingBook = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
            accounts: [{ id: 'source-account', name: 'Sales' }],
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            timeZone: 'UTC',
            permission: Permission.VIEWER,
            accounts: [
                {
                    id: 'inventory-account',
                    name: 'Sales',
                    type: AccountType.INCOMING,
                    permanent: false,
                },
            ],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? originatingBook : inventoryBook
        );
        botService.getInventoryBook = mock(() => new Book({ id: 'inventory-book' }));
        const view = new TestView();

        await createController(view).initialize();

        expect(view.cogsContext?.selectedAccount?.getId()).toBe('inventory-account');
        expect(view.cogsContext?.accounts).toEqual([]);
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('filters Group and whole-Book scopes to permanent Accounts with exchange codes and sorts by name', async () => {
        const inventoryBook = new Book({
            id: 'inventory-book',
            timeZone: 'UTC',
            permission: Permission.VIEWER,
            collection: {
                books: [
                    {
                        id: 'usd-book',
                        fractionDigits: 2,
                        permission: Permission.OWNER,
                        properties: { exc_code: 'USD' },
                    },
                    { id: 'inventory-book', fractionDigits: 0 },
                ],
            },
            groups: [
                { id: 'products', name: 'Products' },
                { id: 'exchange-group', properties: { exc_code: 'USD' } },
            ],
            accounts: [
                {
                    id: 'banana',
                    name: 'Banana',
                    type: AccountType.ASSET,
                    permanent: true,
                    archived: true,
                    groups: [{ id: 'products' }, { id: 'exchange-group' }],
                },
                {
                    id: 'apple',
                    name: 'Apple',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'products' }, { id: 'exchange-group' }],
                },
                {
                    id: 'inventory-payable',
                    name: 'Inventory Payable',
                    type: AccountType.LIABILITY,
                    permanent: true,
                    groups: [{ id: 'products' }, { id: 'exchange-group' }],
                },
                {
                    id: 'missing-exchange',
                    name: 'Missing Exchange',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'products' }],
                },
                {
                    id: 'sales',
                    name: 'Sales',
                    type: AccountType.INCOMING,
                    permanent: false,
                    groups: [{ id: 'products' }],
                },
            ],
        });
        const groupOrigin = new Book({
            id: 'financial-book',
            permission: Permission.EDITOR,
            groups: [{ id: 'source-products', name: 'Products' }],
        });
        bkperService.loadBook = mock(async bookId =>
            bookId === 'financial-book' ? groupOrigin : inventoryBook
        );
        botService.getInventoryBook = mock(() => new Book({ id: 'inventory-book' }));
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://inventory-bot.bkper.app/?bookId=financial-book&groupId=source-products',
            },
        });
        const groupView = new TestView();

        await createController(groupView).initialize();

        expect(groupView.cogsContext?.accounts.map(account => account.getId())).toEqual([
            'apple',
            'banana',
            'inventory-payable',
        ]);
        expect(groupView.cogsContext?.selectedGroup?.getId()).toBe('products');

        Object.defineProperty(self, 'location', {
            configurable: true,
            value: { href: 'https://inventory-bot.bkper.app/?bookId=inventory-book' },
        });
        bkperService.loadBook = mock(async () => inventoryBook);
        botService.getInventoryBook = mock(book => book);
        const wholeBookView = new TestView();

        await createController(wholeBookView).initialize();

        expect(wholeBookView.cogsContext?.accounts.map(account => account.getId())).toEqual([
            'apple',
            'banana',
            'inventory-payable',
        ]);
        expect(wholeBookView.cogsContext?.resetEnabled).toBe(true);
    });

    it('reports Financial Book edit availability for the visible Account scope', async () => {
        const inventoryBook = new Book({
            id: 'inventory-book',
            timeZone: 'UTC',
            permission: Permission.VIEWER,
            collection: {
                books: [
                    {
                        id: 'usd-book',
                        fractionDigits: 2,
                        permission: Permission.EDITOR,
                        properties: { exc_code: 'USD' },
                    },
                    {
                        id: 'eur-book',
                        fractionDigits: 2,
                        permission: Permission.VIEWER,
                        properties: { exc_code: 'EUR' },
                    },
                    { id: 'inventory-book', fractionDigits: 0 },
                ],
            },
            groups: [
                { id: 'usd-group', properties: { exc_code: 'USD' } },
                { id: 'eur-group', properties: { exc_code: 'EUR' } },
            ],
            accounts: [
                {
                    id: 'apple',
                    name: 'Apple',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'usd-group' }],
                },
                {
                    id: 'banana',
                    name: 'Banana',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'eur-group' }],
                },
            ],
        });
        bkperService.loadBook = mock(async () => inventoryBook);
        botService.getInventoryBook = mock(book => book);
        const view = new TestView();

        await createController(view).initialize();

        expect(view.hasEditorPermission).toBe(false);
        expect(view.error?.message.before).toContain('EUR');
        expect(view.error?.message.before).not.toContain('USD');
        expect(view.appState).toBe(BotAppState.READY);
    });

    it('accepts only trusted same-origin App URL changes while idle', async () => {
        const view = new TestView();
        const controller = createController(view);
        const nextUrl = 'https://inventory-bot.bkper.app/?bookId=next-book';

        await handleMessage(controller, createUrlChange(nextUrl));
        await handleMessage(
            controller,
            createUrlChange(
                'https://inventory-bot.bkper.app/?bookId=ignored',
                'https://example.com'
            )
        );
        await handleMessage(controller, createUrlChange('https://example.com/?bookId=ignored'));

        expect(replaceState).toHaveBeenCalledTimes(1);
        expect(self.location.href).toBe(nextUrl);
    });

    it('ignores App URL changes while an operation owns the UI', async () => {
        const view = new TestView();
        view.appState = BotAppState.EXECUTING;
        const controller = createController(view);

        await handleMessage(
            controller,
            createUrlChange('https://inventory-bot.bkper.app/?bookId=ignored-book')
        );

        expect(replaceState).not.toHaveBeenCalled();
    });

    it('maps selected Accounts and Groups into the Inventory Book by name', async () => {
        const selectedBook = new Book({
            id: 'financial-book',
            accounts: [{ id: 'financial-item', name: 'Apple' }],
            groups: [{ id: 'financial-group', name: 'Products' }],
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            accounts: [{ id: 'inventory-item', name: 'Apple' }],
            groups: [{ id: 'inventory-group', name: 'Products' }],
        });
        const controller = createController(new TestView());

        const account = await loadAccount.call(
            controller,
            selectedBook,
            inventoryBook,
            new URL(
                'https://inventory-bot.bkper.app/?bookId=financial-book&accountId=financial-item'
            )
        );
        const group = await loadGroup.call(
            controller,
            selectedBook,
            inventoryBook,
            new URL(
                'https://inventory-bot.bkper.app/?bookId=financial-book&groupId=financial-group'
            )
        );

        expect(account?.getId()).toBe('inventory-item');
        expect(group?.getId()).toBe('inventory-group');
    });

    it('reports a missing mapped Inventory resource', async () => {
        const selectedBook = new Book({
            id: 'financial-book',
            name: 'Financial Book',
            accounts: [{ id: 'financial-item', name: 'Apple' }],
        });
        const inventoryBook = new Book({
            id: 'inventory-book',
            name: 'Inventory Book',
            accounts: [],
            groups: [],
        });
        inventoryBook.getAccount = async () => undefined;
        const view = new TestView();
        const controller = createController(view);

        const account = await loadAccount.call(
            controller,
            selectedBook,
            inventoryBook,
            new URL(
                'https://inventory-bot.bkper.app/?bookId=financial-book&accountId=financial-item'
            )
        );

        expect(account).toBeNull();
        expect(view.appState).toBe(BotAppState.ERROR);
        expect(view.error?.title).toBe('Account not found.');
        expect(view.error?.message.before).toContain('Inventory Book');
    });
});
