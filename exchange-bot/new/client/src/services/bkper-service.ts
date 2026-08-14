import { Bkper, type App, type Book } from 'bkper-js';

class BkperService {
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
