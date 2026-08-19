import { App, Bkper, type Book } from 'bkper-js';
import {
    APP_ID,
    APP_LOGO_URL_DARK,
    APP_LOGO_URL_LIGHT,
    APP_NAME,
    APP_REPOSITORY_URL,
    APP_WEBSITE_URL,
} from '../constants.js';

class BkperService {
    /**
     * Loads the global App, enriching missing metadata from local constants.
     * Returns a complete local App when the global App cannot be loaded.
     *
     * @returns A promise that resolves to the App metadata.
     */
    async loadApp(): Promise<App> {
        const localApp = this.loadLocalApp();
        try {
            const app = await new Bkper().getApp(APP_ID);
            app.payload = {
                ...app.payload,
                id: app.getId() ?? localApp.getId(),
                name: app.getName() ?? localApp.getName(),
                logoUrl: app.getLogoUrl() ?? localApp.getLogoUrl(),
                logoUrlDark: app.getLogoUrlDark() ?? localApp.getLogoUrlDark(),
                website: app.getWebsiteUrl() ?? localApp.getWebsiteUrl(),
                repoUrl: app.getRepositoryUrl() ?? localApp.getRepositoryUrl(),
            };
            return app;
        } catch {
            return localApp;
        }
    }

    private loadLocalApp(): App {
        return new App({
            id: APP_ID,
            name: APP_NAME,
            logoUrl: APP_LOGO_URL_LIGHT,
            logoUrlDark: APP_LOGO_URL_DARK,
            website: APP_WEBSITE_URL,
            repoUrl: APP_REPOSITORY_URL,
        });
    }

    /**
     * Loads a Book, optionally with its complete Account chart.
     *
     * @param bookId - The unique identifier of the Book to load.
     * @param loadAccounts - Whether to include the Book's Accounts and Groups.
     * @returns A promise that resolves to the requested Book.
     */
    async loadBook(bookId: string, loadAccounts = false): Promise<Book> {
        return new Bkper().getBook(bookId, loadAccounts);
    }

    /**
     * Loads an installed App from a Book.
     *
     * @param book - The Book whose installed Apps will be searched.
     * @param appId - The universal identifier of the App to load.
     * @returns A promise that resolves to the installed App, or null if not found.
     */
    async loadInstalledApp(book: Book, appId: string): Promise<App | null> {
        const apps = await book.getApps();
        return apps.find(app => app.getId() === appId) ?? null;
    }
}

export const bkperService = new BkperService();
