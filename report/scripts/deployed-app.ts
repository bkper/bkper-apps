/**
 * Runs a browser check on the deployed app, such as `https://report-preview.bkper.app`, with
 * your token. The platform serves a deployed client only with a Bkper session cookie, which a
 * check cannot have, so this serves the app's origin from the client build that was deployed
 * (`dist/client`, the files `bkper app deploy` uploads) and sends its `/api/*` to the deployed
 * Worker. The client then signs in where `@bkper/web-auth` asks: the local Vite client on its
 * own origin (`bkper/dev`), a deployed one at Bkper, whose answer this gives with the token.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { BrowserContext } from 'playwright-core';

const BKPER = 'https://bkper.app';

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

/** Whether the app at `origin` is the local Vite client. */
export function isLocalApp(origin: string): boolean {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** The URL the app at `appOrigin` refreshes its access token from. */
export function authRefreshUrl(appOrigin: string): string {
    return `${isLocalApp(appOrigin) ? new URL(appOrigin).origin : BKPER}/auth/refresh`;
}

/** The answer that gives the app at `appOrigin` `token`, readable across origins with cookies. */
export function authRefreshAnswer(
    appOrigin: string,
    token: string
): { status: number; contentType: string; headers: Record<string, string>; body: string } {
    return {
        status: 200,
        contentType: 'application/json',
        headers: {
            'Access-Control-Allow-Origin': new URL(appOrigin).origin,
            'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ accessToken: token }),
    };
}

/**
 * The file of the client build at `clientDir` that serves `pathname`: the file itself, the app's
 * page for a path with no extension, or `undefined` (an API path, a missing asset, or a path
 * outside the build).
 */
export function clientFile(clientDir: string, pathname: string): string | undefined {
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/openapi.json')
        return undefined;
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return undefined;
    }
    if (!extname(decoded)) return join(clientDir, 'index.html');
    const root = normalize(clientDir + sep);
    const file = normalize(join(clientDir, decoded));
    return file.startsWith(root) ? file : undefined;
}

/**
 * Serves the deployed app at `appOrigin` in `context`: its pages from `clientDir`, its sign-in
 * with `token`. Its API reaches the deployed Worker, unless the check routes it. Register it
 * after the check's own routes, which it falls back to; for the local client it adds nothing.
 */
export async function serveDeployedApp(
    context: BrowserContext,
    appOrigin: string,
    token: string,
    clientDir = 'dist/client'
): Promise<void> {
    if (isLocalApp(appOrigin)) return;
    const origin = new URL(appOrigin).origin;
    await context.route(authRefreshUrl(origin), route =>
        route.fulfill(authRefreshAnswer(origin, token))
    );
    await context.route(`${origin}/**`, async route => {
        const request = route.request();
        const file =
            request.method() === 'GET'
                ? clientFile(clientDir, new URL(request.url()).pathname)
                : undefined;
        if (!file) return route.fallback();
        try {
            const body = await readFile(file);
            return route.fulfill({
                body,
                contentType: TYPES[extname(file)] ?? 'application/octet-stream',
            });
        } catch {
            return route.fulfill({ status: 404, body: '' });
        }
    });
}
