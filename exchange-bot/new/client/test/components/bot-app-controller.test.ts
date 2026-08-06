import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Book } from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController, BotAppState } from '../../src/components/bot-app-controller.js';
import type { BotAppView } from '../../src/components/bot-app-view.js';
import { authService } from '../../src/services/auth-service.js';
import { bookService } from '../../src/services/book-service.js';

class TestView implements ReactiveControllerHost {
    state = BotAppState.LOADING;
    book?: Book;
    error = '';
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
const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');

beforeEach(() => {
    Object.defineProperty(self, 'location', {
        configurable: true,
        value: { href: 'https://exchange-bot.bkper.app/?bookId=book-id' },
    });
});

afterEach(() => {
    authService.init = originalInit;
    authService.accessToken = undefined;
    bookService.loadBook = originalLoadBook;
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
        const book = new Book({ id: 'book-id', name: 'USD Book' });
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        bookService.loadBook = mock(async () => book);
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();

        expect(view.state).toBe(BotAppState.LOADING);
        await initialization;
        expect(bookService.loadBook).toHaveBeenCalledWith('book-id');
        expect(view.book).toBe(book);
        expect(view.state).toBe(BotAppState.READY);
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
        expect(view.state).toBe(BotAppState.ERROR);
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
        expect(view.state).toBe(BotAppState.ERROR);
    });

    it('stays loading when authentication does not establish a session', async () => {
        authService.init = async () => {};
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.state).toBe(BotAppState.LOADING);
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
