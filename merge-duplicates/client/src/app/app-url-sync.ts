const BKPER_ORIGINS: ReadonlySet<string> = new Set(['https://bkper.app', 'https://dev.bkper.app']);
const URL_CHANGE_DEBOUNCE_MS = 250;
const LOG_PREFIX = '[merge-duplicates:sync]';

export interface TrustedAppUrlContext {
    parent: unknown;
    appOrigin: string;
}

export interface AppUrlChangeEvent {
    source: unknown;
    origin: string;
    data: unknown;
}

export type AppUrlChangeHandler = (url: URL) => void | Promise<void>;

export interface AppUrlSync {
    start(handler: AppUrlChangeHandler): void;
    stop(): void;
    replace(url: URL): void;
}

export function readTrustedAppUrlChange(
    event: AppUrlChangeEvent,
    context: TrustedAppUrlContext
): URL | undefined {
    if (event.source !== context.parent || !isTrustedBkperOrigin(event.origin, context.appOrigin)) {
        return undefined;
    }
    if (!isRecord(event.data)) return undefined;
    if (event.data.type !== 'bkper:app-url-changed' || typeof event.data.url !== 'string') {
        return undefined;
    }

    try {
        const url = new URL(event.data.url);
        return url.origin === context.appOrigin ? url : undefined;
    } catch {
        return undefined;
    }
}

export function createAppUrlSync(): AppUrlSync {
    return new BrowserAppUrlSync();
}

function isTrustedBkperOrigin(parentOrigin: string, appOrigin: string): boolean {
    if (BKPER_ORIGINS.has(parentOrigin)) return true;

    try {
        const parentUrl = new URL(parentOrigin);
        const appUrl = new URL(appOrigin);
        return isLoopbackHost(parentUrl.hostname) && isLoopbackHost(appUrl.hostname);
    } catch {
        return false;
    }
}

function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

class BrowserAppUrlSync implements AppUrlSync {
    private handler?: AppUrlChangeHandler;
    private timeoutId?: number;
    private pendingUrl?: URL;

    private readonly onMessage = (event: MessageEvent): void => {
        console.debug(LOG_PREFIX, 'message received', {
            origin: event.origin,
            sourceIsParent: event.source === window.parent,
            type: isRecord(event.data) ? event.data.type : undefined,
        });

        const url = readTrustedAppUrlChange(event, {
            parent: window.parent,
            appOrigin: window.location.origin,
        });
        if (!url) {
            console.debug(LOG_PREFIX, 'message rejected');
            return;
        }

        console.debug(LOG_PREFIX, 'message accepted', url.toString());
        this.pendingUrl = url;
        if (this.timeoutId !== undefined) window.clearTimeout(this.timeoutId);
        this.timeoutId = window.setTimeout(() => {
            const nextUrl = this.pendingUrl;
            this.pendingUrl = undefined;
            this.timeoutId = undefined;
            if (nextUrl && this.handler) {
                console.debug(LOG_PREFIX, 'dispatching context change', nextUrl.toString());
                void this.handler(nextUrl);
            }
        }, URL_CHANGE_DEBOUNCE_MS);
    };

    start(handler: AppUrlChangeHandler): void {
        this.stop();
        this.handler = handler;
        console.debug(LOG_PREFIX, 'listener started', window.location.origin);
        window.addEventListener('message', this.onMessage);
    }

    stop(): void {
        window.removeEventListener('message', this.onMessage);
        if (this.timeoutId !== undefined) window.clearTimeout(this.timeoutId);
        this.timeoutId = undefined;
        this.pendingUrl = undefined;
        this.handler = undefined;
    }

    replace(url: URL): void {
        window.history.replaceState(window.history.state, '', url);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
