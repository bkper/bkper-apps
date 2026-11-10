import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '../client/src/auth/auth-session';
import { authRefreshAnswer, authRefreshUrl, clientFile, isLocalApp } from '../scripts/deployed-app';

afterEach(() => vi.unstubAllGlobals());

/** Signs in the app's own auth session at `appUrl`, answering its refresh as a check does. */
async function signIn(appUrl: string, token: string): Promise<{ asked: string; token?: string }> {
    const appOrigin = new URL(appUrl).origin;
    vi.stubGlobal('window', { location: new URL(appUrl) });
    let asked = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        asked = String(input);
        if (asked !== authRefreshUrl(appOrigin)) return new Response('', { status: 404 });
        const answer = authRefreshAnswer(appOrigin, token);
        return new Response(answer.body, {
            status: answer.status,
            headers: { 'Content-Type': answer.contentType, ...answer.headers },
        });
    });
    const auth = createAuthSession();
    await auth.refresh();
    return { asked, token: auth.getAccessToken() };
}

describe('signing in a browser check', () => {
    it('answers the local client on its own origin', async () => {
        expect(await signIn('http://localhost:5207/?book=b', 'local-token')).toEqual({
            asked: 'http://localhost:5207/auth/refresh',
            token: 'local-token',
        });
        expect(isLocalApp('http://127.0.0.1:5207')).toBe(true);
    });

    it('answers a deployed client where it asks Bkper', async () => {
        expect(await signIn('https://report-preview.bkper.app/?book=b', 'preview-token')).toEqual({
            asked: 'https://bkper.app/auth/refresh',
            token: 'preview-token',
        });
        expect(isLocalApp('https://report-preview.bkper.app')).toBe(false);
    });

    it('lets only the app read the token across origins, with cookies', () => {
        const answer = authRefreshAnswer('https://report-preview.bkper.app/path', 'secret');
        expect(answer.headers).toEqual({
            'Access-Control-Allow-Origin': 'https://report-preview.bkper.app',
            'Access-Control-Allow-Credentials': 'true',
        });
        expect(JSON.parse(answer.body)).toEqual({ accessToken: 'secret' });
    });
});

describe('serving the deployed client build', () => {
    it('serves the app page, its files, and nothing else', () => {
        expect(clientFile('/build', '/')).toBe('/build/index.html');
        expect(clientFile('/build', '/dev/report')).toBe('/build/index.html');
        expect(clientFile('/build', '/assets/index-a1.js')).toBe('/build/assets/index-a1.js');
        expect(clientFile('/build', '/images/logo%20dark.svg')).toBe('/build/images/logo dark.svg');
    });

    it('leaves the API to the deployed Worker', () => {
        expect(clientFile('/build', '/api/v1/books/b/report')).toBeUndefined();
        expect(clientFile('/build', '/api')).toBeUndefined();
        expect(clientFile('/build', '/openapi.json')).toBeUndefined();
    });

    it('never serves a file outside the build', () => {
        expect(clientFile('/build', '/%2e%2e/secret.txt')).toBeUndefined();
        expect(clientFile('/build', '/assets/%E0%A4%A.js')).toBeUndefined();
    });
});
