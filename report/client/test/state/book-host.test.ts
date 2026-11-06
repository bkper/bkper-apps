import { describe, expect, it, vi } from 'vitest';
import { AppUrlChange, BookHost, type HostPage } from '../../src/state/book-host';

const BKPER = 'https://bkper.app';
const READY = { type: 'bkper:host-ready', supports: ['navigate', 'expand', 'app-state'] };

function createHost(origin = 'https://report.bkper.app') {
    const parent = { postMessage: vi.fn() };
    const page: HostPage = Object.assign(new EventTarget(), { parent, location: { origin } });
    const host = new BookHost(page);
    const urls: string[] = [];
    let readies = 0;
    host.addEventListener('app-url-changed', event => {
        if (event instanceof AppUrlChange) urls.push(event.url);
    });
    host.addEventListener('ready', () => readies++);
    host.connect();
    const send = (data: unknown, from: { origin?: string; source?: unknown } = {}) => {
        const event = new MessageEvent('message', { data, origin: from.origin ?? BKPER });
        Object.defineProperty(event, 'source', { value: from.source ?? parent });
        page.dispatchEvent(event);
    };
    return { host, parent, send, urls, readies: () => readies };
}

describe('BookHost', () => {
    it('sends the state only after the Book says it keeps it, to the Book’s origin', () => {
        const { host, parent, send } = createHost();

        expect(host.sendState('s1')).toBe(false);
        send({ type: 'bkper:host-ready', supports: ['navigate', 'expand'] });
        expect(host.acceptsState).toBe(false);
        expect(host.sendState('s1')).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();

        send(READY);
        expect(host.acceptsState).toBe(true);
        expect(host.sendState('s2')).toBe(true);
        expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith(
            { type: 'bkper:app-state', state: 's2' },
            BKPER
        );
    });

    it('listens only to the parent window on a Bkper origin', () => {
        const { host, send, urls, readies } = createHost();
        send(READY, { source: { postMessage: vi.fn() } });
        send(READY, { origin: 'https://evil.example' });
        send(READY, { origin: 'https://other-app.bkper.app' });
        send(READY, { origin: 'http://localhost:8080' });
        send(
            { type: 'bkper:app-url-changed', url: 'https://report.bkper.app/?state=x' },
            { origin: 'https://evil.example' }
        );

        expect(host.acceptsState).toBe(false);
        expect(readies()).toBe(0);
        expect(urls).toEqual([]);
    });

    it('trusts Bkper run locally only when the app runs locally too', () => {
        const { host, send } = createHost('http://localhost:5207');
        send(READY, { origin: 'http://localhost:8080' });
        expect(host.acceptsState).toBe(true);
    });

    it('stops sending when a later host-ready no longer lists app-state', () => {
        const { host, send, readies } = createHost();
        send(READY);
        send({ type: 'bkper:host-ready', supports: [] });
        expect(host.acceptsState).toBe(false);
        expect(readies()).toBe(2);
    });

    it('tells new URLs of the app, never of another origin or malformed', () => {
        const { send, urls } = createHost();
        send({ type: 'bkper:app-url-changed', url: 'https://report.bkper.app/?book=b&state=s' });
        send({ type: 'bkper:app-url-changed', url: 'https://evil.example/?book=b' });
        send({ type: 'bkper:app-url-changed', url: 'not a url' });
        send({ type: 'bkper:app-url-changed', url: 42 });

        expect(urls).toEqual(['https://report.bkper.app/?book=b&state=s']);
    });

    it('hears nothing standalone', () => {
        const page = Object.assign(new EventTarget(), {
            location: { origin: 'https://report.bkper.app' },
        });
        const self = Object.assign(page, { parent: { postMessage: vi.fn() } });
        Object.defineProperty(self, 'parent', { value: self });
        const host = new BookHost(self);
        const listen = vi.spyOn(self, 'addEventListener');
        host.connect();
        expect(listen).not.toHaveBeenCalled();
    });
});
