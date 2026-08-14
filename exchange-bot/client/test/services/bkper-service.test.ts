import { afterEach, describe, expect, it, mock } from 'bun:test';
import { App, Bkper, Book } from 'bkper-js';
import {
    APP_ID,
    APP_LOGO_URL_DARK,
    APP_LOGO_URL_LIGHT,
    APP_NAME,
    APP_REPOSITORY_URL,
    APP_WEBSITE_URL,
} from '../../src/constants.js';
import { bkperService } from '../../src/services/bkper-service.js';

const originalGetApp = Bkper.prototype.getApp;
const originalGetBook = Bkper.prototype.getBook;
const originalConfig = new Bkper().getConfig();

afterEach(() => {
    Bkper.prototype.getApp = originalGetApp;
    Bkper.prototype.getBook = originalGetBook;
    Bkper.setConfig(originalConfig);
});

describe('Bkper service', () => {
    it('loads the global App and enriches missing metadata from local constants', async () => {
        const app = new App({
            id: APP_ID,
            name: 'Global Exchange Bot',
            logoUrl: 'https://example.com/global-light.svg',
            website: 'https://example.com/exchange-bot',
        });
        Bkper.prototype.getApp = mock(async () => app);

        const loadedApp = await bkperService.loadApp();

        expect(Bkper.prototype.getApp).toHaveBeenCalledWith(APP_ID);
        expect(loadedApp).toBe(app);
        expect(loadedApp.getName()).toBe('Global Exchange Bot');
        expect(loadedApp.getLogoUrl()).toBe('https://example.com/global-light.svg');
        expect(loadedApp.getLogoUrlDark()).toBe(APP_LOGO_URL_DARK);
        expect(loadedApp.getWebsiteUrl()).toBe('https://example.com/exchange-bot');
        expect(loadedApp.getRepositoryUrl()).toBe(APP_REPOSITORY_URL);
    });

    it('returns complete local App metadata when the global App cannot be loaded', async () => {
        Bkper.prototype.getApp = mock(async () => {
            throw new Error('App unavailable');
        });

        const loadedApp = await bkperService.loadApp();

        expect(loadedApp.getId()).toBe(APP_ID);
        expect(loadedApp.getName()).toBe(APP_NAME);
        expect(loadedApp.getLogoUrl()).toBe(APP_LOGO_URL_LIGHT);
        expect(loadedApp.getLogoUrlDark()).toBe(APP_LOGO_URL_DARK);
        expect(loadedApp.getWebsiteUrl()).toBe(APP_WEBSITE_URL);
        expect(loadedApp.getRepositoryUrl()).toBe(APP_REPOSITORY_URL);
    });

    it('loads a lean Book through bkper-js', async () => {
        const book = new Book({ id: 'book-id', name: 'USD Book' });
        Bkper.prototype.getBook = mock(async () => book);

        const loadedBook = await bkperService.loadBook('book-id');

        expect(Bkper.prototype.getBook).toHaveBeenCalledWith('book-id', false);
        expect(loadedBook).toBe(book);
    });

    it('loads a Book with its complete Account chart when explicitly requested', async () => {
        const book = new Book({ id: 'book-id', name: 'USD Book' });
        Bkper.prototype.getBook = mock(async () => book);

        const loadedBook = await bkperService.loadBook('book-id', true);

        expect(Bkper.prototype.getBook).toHaveBeenCalledWith('book-id', true);
        expect(loadedBook).toBe(book);
    });

    it('loads an installed App by its universal id', async () => {
        const book = new Book({ id: 'book-id' });
        const app = new App({ id: 'exchange-bot' });
        book.getApps = mock(async () => [app]);

        const loadedApp = await bkperService.loadInstalledApp(book, 'exchange-bot');

        expect(book.getApps).toHaveBeenCalledTimes(1);
        expect(loadedApp).toBe(app);
    });

    it('returns null when the App is not installed', async () => {
        const book = new Book({ id: 'book-id' });
        book.getApps = mock(async () => []);

        const loadedApp = await bkperService.loadInstalledApp(book, 'exchange-bot');

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

        await bkperService.loadBook('book-id');

        expect(configuredToken).toBe('access-token');
    });
});
