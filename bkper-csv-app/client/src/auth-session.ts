import { BkperAuth } from '@bkper/web-auth';

export type AuthSession = Pick<BkperAuth, 'getAccessToken' | 'init' | 'login'>;

export interface AuthSessionCallbacks {
    onLoginSuccess: () => void;
    onLoginRequired: () => void;
    onError: (error: unknown) => void;
}

export function createAuthSession(callbacks: AuthSessionCallbacks): AuthSession {
    const isLocalDevelopment =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    return new BkperAuth({
        baseUrl: isLocalDevelopment ? window.location.origin : undefined,
        ...callbacks,
    });
}
