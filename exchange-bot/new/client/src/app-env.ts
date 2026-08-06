class AppEnv {
    getAuthBaseUrl(): string | undefined {
        return this.isLocal() ? self.location.origin : undefined;
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
}

export const appEnv = new AppEnv();
