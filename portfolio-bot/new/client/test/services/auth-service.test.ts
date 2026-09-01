import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { authService } from '../../src/services/auth-service.js';

const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');
const originalOnLine = Object.getOwnPropertyDescriptor(self.navigator, 'onLine');
const assign = mock((_url: string | URL) => {});

beforeEach(() => {
    Reflect.set(authService, 'bkperAuthClient', undefined);
    Reflect.set(authService, 'initialization', undefined);
    authService.accessToken = undefined;
    assign.mockClear();
    Object.defineProperty(self, 'location', {
        configurable: true,
        value: {
            assign,
            hostname: 'localhost',
            href: 'http://localhost:5179/?bookId=book-id',
            origin: 'http://localhost:5179',
        },
    });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLocation) {
        Object.defineProperty(self, 'location', originalLocation);
    } else {
        Reflect.deleteProperty(self, 'location');
    }
    if (originalOnLine) {
        Object.defineProperty(self.navigator, 'onLine', originalOnLine);
    } else {
        Reflect.deleteProperty(self.navigator, 'onLine');
    }
});

function setOnline(online: boolean): void {
    Object.defineProperty(self.navigator, 'onLine', {
        configurable: true,
        value: online,
    });
}

describe('auth service', () => {
    it('does not initialize while offline', async () => {
        setOnline(false);
        const fetchMock = Object.assign(
            mock(async () => Response.json({ accessToken: 'access-token' })),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        await authService.init();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(authService.accessToken).toBeUndefined();
    });

    it('initializes once and refreshes the access token', async () => {
        setOnline(true);
        const tokens = ['first-token', 'refreshed-token'];
        const fetchMock = Object.assign(
            mock(async () => Response.json({ accessToken: tokens.shift() })),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        await authService.init();
        await authService.init();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(authService.accessToken).toBe('first-token');

        await authService.refresh();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(authService.accessToken).toBe('refreshed-token');
    });

    it('shares in-progress initialization between callers', async () => {
        setOnline(true);
        let resolveFetch: (response: Response) => void = () => {};
        const fetchResponse = new Promise<Response>(resolve => {
            resolveFetch = resolve;
        });
        const fetchMock = Object.assign(
            mock(async () => fetchResponse),
            {
                preconnect: originalFetch.preconnect,
            }
        );
        globalThis.fetch = fetchMock;
        let secondCompleted = false;

        const firstInitialization = authService.init();
        const secondInitialization = authService.init().then(() => {
            secondCompleted = true;
        });
        await Promise.resolve();
        const secondCompletedBeforeResponse = secondCompleted;
        resolveFetch(Response.json({ accessToken: 'access-token' }));
        await Promise.all([firstInitialization, secondInitialization]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(secondCompletedBeforeResponse).toBe(false);
        expect(authService.accessToken).toBe('access-token');
    });

    it('starts login when no authenticated session exists', async () => {
        setOnline(true);
        globalThis.fetch = Object.assign(
            mock(async () => new Response(null, { status: 401 })),
            { preconnect: originalFetch.preconnect }
        );

        await authService.init();

        expect(assign).toHaveBeenCalledWith(
            'http://localhost:5179/auth/login?returnUrl=http%3A%2F%2Flocalhost%3A5179%2F%3FbookId%3Dbook-id'
        );
    });
});
