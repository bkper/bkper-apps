import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, App, Book, Group } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController } from '../../src/components/bot-app-controller.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
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
});

afterEach(() => {
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
