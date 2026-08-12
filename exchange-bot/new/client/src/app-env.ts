import { APP_REPOSITORY_URL, APP_WEBSITE_URL } from './constants';

class AppEnv {
    getBkperApiKey(): string {
        return import.meta.env.BKPER_API_KEY!;
    }

    getAuthBaseUrl(): string | undefined {
        return this.isLocal() ? self.location.origin : undefined;
    }

    getSearchParam(name: string): string | null {
        return new URL(self.location.href).searchParams.get(name);
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

    getBookUrl(id: string): string {
        return `https://bkper.app/books/${encodeURIComponent(id)}/transactions`;
    }

    getAppWebsiteUrl(): string {
        return APP_WEBSITE_URL;
    }

    getAppRepositoryUrl(): string {
        return APP_REPOSITORY_URL;
    }
}

export const appEnv = new AppEnv();
