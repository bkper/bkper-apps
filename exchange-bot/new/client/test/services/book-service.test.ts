import { afterEach, describe, expect, it, mock } from 'bun:test';
import { App, Bkper, Book } from 'bkper-js';
import { bookService } from '../../src/services/book-service.js';

const originalGetBook = Bkper.prototype.getBook;
const originalConfig = new Bkper().getConfig();

afterEach(() => {
    Bkper.prototype.getBook = originalGetBook;
    Bkper.setConfig(originalConfig);
});

describe('book service', () => {
    it('loads a lean Book through bkper-js', async () => {
        const book = new Book({ id: 'book-id', name: 'USD Book' });
        Bkper.prototype.getBook = mock(async () => book);

        const loadedBook = await bookService.loadBook('book-id');

        expect(Bkper.prototype.getBook).toHaveBeenCalledWith('book-id', false);
        expect(loadedBook).toBe(book);
    });

    it('loads a Book with its complete Account chart when explicitly requested', async () => {
        const book = new Book({ id: 'book-id', name: 'USD Book' });
        Bkper.prototype.getBook = mock(async () => book);

        const loadedBook = await bookService.loadBook('book-id', true);

        expect(Bkper.prototype.getBook).toHaveBeenCalledWith('book-id', true);
        expect(loadedBook).toBe(book);
    });

    it('loads an installed App by its universal id', async () => {
        const book = new Book({ id: 'book-id' });
        const app = new App({ id: 'exchange-bot' });
        book.getApps = mock(async () => [app]);

        const loadedApp = await bookService.loadInstalledApp(book, 'exchange-bot');

        expect(book.getApps).toHaveBeenCalledTimes(1);
        expect(loadedApp).toBe(app);
    });

    it('returns null when the App is not installed', async () => {
        const book = new Book({ id: 'book-id' });
        book.getApps = mock(async () => []);

        const loadedApp = await bookService.loadInstalledApp(book, 'exchange-bot');

        expect(loadedApp).toBeNull();
    });

    it('uses API configuration initialized after singleton creation', async () => {
        const book = new Book({ id: 'book-id' });
        Bkper.setConfig({ oauthTokenProvider: async () => 'access-token' });
        let configuredToken: string | undefined;
        Bkper.prototype.getBook = mock(async function (this: Bkper) {
            configuredToken = await this.getConfig().oauthTokenProvider?.();
            return book;
        });

        await bookService.loadBook('book-id');

        expect(configuredToken).toBe('access-token');
    });
});
