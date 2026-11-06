import { describe, expect, it } from 'vitest';
import { Navigation, Route, type RoutePage } from '../../src/state/route';

function createPage(href: string) {
    const listeners = new Set<() => void>();
    const writes: { mode: 'push' | 'replace'; href: string }[] = [];
    const page: RoutePage = {
        location: { href },
        history: {
            state: null,
            pushState: (_data, _unused, url) => {
                writes.push({ mode: 'push', href: String(url) });
                page.location.href = String(url);
            },
            replaceState: (_data, _unused, url) => {
                writes.push({ mode: 'replace', href: String(url) });
                page.location.href = String(url);
            },
        },
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
    };
    const goTo = (url: string) => {
        page.location.href = url;
        for (const listener of listeners) listener();
    };
    return { page, writes, goTo };
}

describe('Route', () => {
    it('reads the selected Book from the URL', () => {
        const { page } = createPage('https://report.bkper.app/?book=book-1&query=x');

        expect(new Route(page, false).bookId).toBe('book-1');
    });

    it('adds a history entry per selection when standalone, keeping other parameters', () => {
        const { page, writes } = createPage('https://report.bkper.app/?query=x');
        const route = new Route(page, false);

        route.select('book 1');
        route.select(undefined);

        expect(route.bookId).toBeUndefined();
        expect(writes).toEqual([
            { mode: 'push', href: 'https://report.bkper.app/?query=x&book=book+1' },
            { mode: 'push', href: 'https://report.bkper.app/?query=x' },
        ]);
    });

    it('only replaces the URL when embedded in a Book, so Back stays the Book’s', () => {
        const { page, writes } = createPage('https://report.bkper.app/');
        const route = new Route(page, true);

        route.select('book-1');

        expect(writes).toEqual([
            { mode: 'replace', href: 'https://report.bkper.app/?book=book-1' },
        ]);
    });

    it('does not write a URL that already shows the selection', () => {
        const { page, writes } = createPage('https://report.bkper.app/?book=book-1');

        new Route(page, false).select('book-1');

        expect(writes).toEqual([]);
    });

    it('writes no history when following Back to a URL that already shows the selection', () => {
        const { page, writes } = createPage(
            "https://report.bkper.app/?book=book-1&query=account%3A'Sales%20Revenue'"
        );

        new Route(page, false).select('book-1');

        expect(writes).toEqual([]);
    });

    it('reports Back and Forward while connected', () => {
        const { page, goTo } = createPage('https://report.bkper.app/?book=book-1');
        const route = new Route(page, false);
        const navigations: (string | undefined)[] = [];
        route.addEventListener('navigate', event => {
            if (event instanceof Navigation) navigations.push(event.bookId);
        });

        route.connect();
        goTo('https://report.bkper.app/');
        goTo('https://report.bkper.app/?book=book-2');
        route.disconnect();
        goTo('https://report.bkper.app/');

        expect(navigations).toEqual([undefined, 'book-2']);
    });

    it('reads the request from the URL', () => {
        const { page } = createPage('https://report.bkper.app/?book=book-1&q=despesas%20em%202011');

        expect(new Route(page, false).prompt).toBe('despesas em 2011');
    });

    it('keeps the request in the URL by replacing it, so typing adds no history', () => {
        const { page, writes } = createPage('https://report.bkper.app/?book=book-1');
        const route = new Route(page, false);

        route.setPrompt('despesas em 2011');
        route.setPrompt('');

        expect(route.prompt).toBe('');
        expect(writes).toEqual([
            {
                mode: 'replace',
                href: 'https://report.bkper.app/?book=book-1&q=despesas+em+2011',
            },
            { mode: 'replace', href: 'https://report.bkper.app/?book=book-1' },
        ]);
    });

    it('round-trips a request through the URL', () => {
        const { page } = createPage('https://report.bkper.app/?book=book-1');
        new Route(page, false).setPrompt('  Receitas & #tag 2011? ');

        expect(new Route(page, false).prompt).toBe('  Receitas & #tag 2011? ');
    });

    it('selecting another Book drops the request of the previous one', () => {
        const { page } = createPage('https://report.bkper.app/?book=book-1&q=despesas');
        const route = new Route(page, false);

        route.select('book-2');

        expect(route.prompt).toBe('');
        expect(page.location.href).toBe('https://report.bkper.app/?book=book-2');
    });

    it('reports the request of the URL gone back or forward to', () => {
        const { page, goTo } = createPage('https://report.bkper.app/');
        const route = new Route(page, false);
        const navigations: (string | undefined)[] = [];
        route.addEventListener('navigate', event => {
            if (event instanceof Navigation) navigations.push(event.prompt);
        });

        route.connect();
        goTo('https://report.bkper.app/?book=book-1&q=net%20result');

        expect(route.prompt).toBe('net result');
        expect(navigations).toEqual(['net result']);
    });
});
