import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
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
