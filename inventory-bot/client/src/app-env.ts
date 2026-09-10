import { APP_ID } from './constants';

const BKPER_ORIGIN = 'https://bkper.app';
const BKPER_MENU_EXPRESSION = /^\$\{[^{}]+\}$/;

class AppEnv {
    getBkperApiKey(): string {
        return import.meta.env.BKPER_API_KEY!;
    }

    getAuthBaseUrl(): string | undefined {
        return this.isLocal() ? self.location.origin : undefined;
    }

    getSearchParam(name: string, url: string | URL = self.location.href): string | null {
        const value = new URL(url).searchParams.get(name);
        return value && BKPER_MENU_EXPRESSION.test(value) ? null : value;
    }

    isEmbedded(): boolean {
        return self !== self.top;
    }

    isLocal(): boolean {
        return self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
    }

    isOnline(): boolean {
        if (self.navigator) {
            return self.navigator.onLine;
        }
        return true;
    }

    isOffline(): boolean {
        return !this.isOnline();
    }

    getBkperOrigin(): string {
        return BKPER_ORIGIN;
    }

    getBookUrl(id: string): string {
        return `https://bkper.app/books/${encodeURIComponent(id)}/transactions`;
    }

    getAppUrl(bookId: string): string {
        return `https://bkper.app/automations/${encodeURIComponent(bookId)}/apps/${APP_ID}`;
    }
}

export const appEnv = new AppEnv();
