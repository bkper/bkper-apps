import { bkperOrigins, isLocalOrigin, readHostReady } from '../bkper-host';

/** The window around the app, as far as the app talks to it. */
export interface HostParent {
    postMessage(message: unknown, targetOrigin: string): void;
}

/** The page the app runs in: the browser's `window`, or a double in tests. */
export interface HostPage extends EventTarget {
    readonly parent: HostParent;
    readonly location: { readonly origin: string };
}

/** Bkper says the app's URL changed (`bkper:app-url-changed`) to `url`, on the app's origin. */
export class AppUrlChange extends Event {
    constructor(readonly url: string) {
        super('app-url-changed');
    }
}

/**
 * The Bkper Book page the app is embedded in, from the messages of the parent window on a Bkper
 * origin only. Fires `ready` on each `bkper:host-ready`, and an {@link AppUrlChange} for each
 * `bkper:app-url-changed` of a URL of the app. Sends the report's state (`bkper:app-state`)
 * only while the Book's last `bkper:host-ready` lists `app-state`, and asks it to navigate
 * (`bkper:navigate`) only while it lists `navigate`, each only to its origin. Standalone, it
 * hears and sends nothing.
 */
export class BookHost extends EventTarget {
    /** The origin of the Book page that said it keeps the app's state. */
    private stateOrigin?: string;
    /** The origin of the Book page that said it navigates for the app. */
    private navigateOrigin?: string;
    private listening = false;

    constructor(private readonly page: HostPage) {
        super();
    }

    /** Whether the Book keeps the app's state (`bkper:app-state`). */
    get acceptsState(): boolean {
        return this.stateOrigin !== undefined;
    }

    /** The Bkper origin of the Book that navigates for the app (`bkper:navigate`), if any. */
    get navigationOrigin(): string | undefined {
        return this.navigateOrigin;
    }

    connect(): void {
        if (this.listening || (this.page.parent as unknown) === this.page) return;
        this.listening = true;
        this.page.addEventListener('message', this.onMessage);
    }

    disconnect(): void {
        this.listening = false;
        this.page.removeEventListener('message', this.onMessage);
    }

    /** Ask the Book to keep `state` in its URL, or to drop it with `''`; whether it was sent. */
    sendState(state: string): boolean {
        if (!this.stateOrigin) return false;
        this.page.parent.postMessage({ type: 'bkper:app-state', state }, this.stateOrigin);
        return true;
    }

    /**
     * Ask the Book to open `url`, a page of its own origin, in place; whether it was sent. Only
     * in answer to the person's click: the Book cannot tell.
     */
    navigate(url: string): boolean {
        if (!this.navigateOrigin || !sameOrigin(url, this.navigateOrigin)) return false;
        this.page.parent.postMessage({ type: 'bkper:navigate', url }, this.navigateOrigin);
        return true;
    }

    private readonly onMessage = (event: Event): void => {
        if (!(event instanceof MessageEvent) || event.source !== this.page.parent) return;
        const origins = bkperOrigins(isLocalOrigin(this.page.location.origin));
        if (!origins.includes(event.origin)) return;
        const ready = readHostReady(event.data);
        if (ready) {
            this.stateOrigin = ready.supports.includes('app-state') ? event.origin : undefined;
            this.navigateOrigin = ready.supports.includes('navigate') ? event.origin : undefined;
            this.dispatchEvent(new Event('ready'));
            return;
        }
        const url = appUrlChanged(event.data);
        if (url && sameOrigin(url, this.page.location.origin)) {
            this.dispatchEvent(new AppUrlChange(url));
        }
    };
}

function appUrlChanged(data: unknown): string | undefined {
    if (typeof data !== 'object' || data === null) return undefined;
    if (!('type' in data) || data.type !== 'bkper:app-url-changed') return undefined;
    return 'url' in data && typeof data.url === 'string' ? data.url : undefined;
}

function sameOrigin(url: string, origin: string): boolean {
    try {
        return new URL(url).origin === origin;
    } catch {
        return false;
    }
}
