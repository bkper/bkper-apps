/**
 * The Bkper page around the app or a report file, as its messages tell it: which Bkper origins
 * may host them, and what `bkper:host-ready` says the host accepts.
 */

/** Bkper in production and in development. */
const BKPER_ORIGINS = ['https://bkper.app', 'https://dev.bkper.app'];

/** Bkper run locally, trusted only by a page that runs locally too. */
const LOCAL_BKPER_ORIGIN = 'http://localhost:8080';

/** The Bkper origins that may host a page; Bkper run locally only when `local`. */
export function bkperOrigins(local: boolean): readonly string[] {
    return local ? [...BKPER_ORIGINS, LOCAL_BKPER_ORIGIN] : BKPER_ORIGINS;
}

/** Whether a page of `origin` runs locally, as in development. */
export function isLocalOrigin(origin: string): boolean {
    try {
        const { hostname } = new URL(origin);
        return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
        // An opaque origin, such as a sandboxed frame's, is not local.
        return false;
    }
}

/** What a `bkper:host-ready` message says: the requests the host accepts, and its `origin` if named. */
export interface HostReady {
    supports: readonly string[];
    origin?: string;
}

/** A `bkper:host-ready` message, or `undefined` for anything else. */
export function readHostReady(data: unknown): HostReady | undefined {
    if (typeof data !== 'object' || data === null) return undefined;
    if (!('type' in data) || data.type !== 'bkper:host-ready') return undefined;
    const supports = 'supports' in data && Array.isArray(data.supports) ? data.supports : [];
    const origin = 'origin' in data && typeof data.origin === 'string' ? data.origin : undefined;
    return {
        supports: supports.filter((name): name is string => typeof name === 'string'),
        ...(origin ? { origin } : {}),
    };
}

/** A plain primary click, without the keys that ask the browser to open a link another way. */
export function plainClick(event: MouseEvent): boolean {
    return (
        event.button === 0 &&
        !event.defaultPrevented &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
    );
}
