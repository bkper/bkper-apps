import { BkperAuth } from '@bkper/web-auth';

export interface BrowserLocation {
    hostname: string;
    origin: string;
}

export function getAuthBaseUrl(location: BrowserLocation): string | undefined {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return isLocal ? location.origin : undefined;
}

export function createAuth(location: BrowserLocation = window.location): BkperAuth {
    let auth: BkperAuth;
    auth = new BkperAuth({
        baseUrl: getAuthBaseUrl(location),
        onLoginRequired: () => auth.login(),
    });
    return auth;
}
