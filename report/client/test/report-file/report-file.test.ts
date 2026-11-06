import { REPORT_FILE_DATA_ID, type ReportFileData } from 'report-shared/report-file';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/report/index';
import {
    followColorScheme,
    followFileHost,
    openInReportUrl,
    startReportFile,
} from '../../src/report-file/report-file';
import { gallerySpec } from '../report/gallery-specs';

class FakeColorScheme extends EventTarget {
    constructor(public matches: boolean) {
        super();
    }

    change(matches: boolean): void {
        this.matches = matches;
        this.dispatchEvent(new Event('change'));
    }
}

afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove('wa-dark');
});

describe('report file', () => {
    it('follows the viewer’s light or dark color scheme', () => {
        const root = document.createElement('html');
        const scheme = new FakeColorScheme(true);
        followColorScheme(root, scheme);
        expect(root.classList.contains('wa-dark')).toBe(true);
        scheme.change(false);
        expect(root.classList.contains('wa-dark')).toBe(false);
    });

    it('renders the report and the link the file carries', async () => {
        const data: ReportFileData = {
            spec: gallerySpec('revenue-total'),
            link: { url: 'https://report.bkper.app/?book=b&q=expenses', label: 'Open in Report' },
        };
        const script = document.createElement('script');
        script.type = 'application/json';
        script.id = REPORT_FILE_DATA_ID;
        script.textContent = JSON.stringify(data);
        document.body.append(document.createElement('report-view'), script);

        const view = startReportFile(document, new FakeColorScheme(false));

        expect(view?.spec).toEqual(data.spec);
        expect(view?.link).toEqual(data.link);
        await view?.updateComplete;
        expect(view?.shadowRoot?.querySelector('.answer-amount')?.textContent).toBeTruthy();
    });

    it('renders nothing without data', () => {
        document.body.append(document.createElement('report-view'));
        expect(startReportFile(document, new FakeColorScheme(false))).toBeUndefined();
    });
});

describe('opening the report in the Report app from the file', () => {
    const LINK = { url: 'https://report.bkper.app/?book=b&q=expenses', label: 'Open in Report' };
    const OPEN = { bookId: 'book-1', state: '1MF9hLjIwMTcuLi4xOTEwMDI' };
    const AGENT = 'https://agent.bkper.app';
    const READY = { type: 'bkper:host-ready', supports: ['navigate'], origin: 'https://bkper.app' };
    let stop: (() => void) | undefined;

    afterEach(() => {
        stop?.();
        stop = undefined;
    });

    /** A file page whose parent records what it is sent, with the file's link on it. */
    function filePage(data: Pick<ReportFileData, 'link' | 'open'> = { link: LINK, open: OPEN }) {
        const parent = { postMessage: vi.fn() };
        const page = Object.assign(new EventTarget(), { parent });
        const root = document.createElement('div');
        const link = document.createElement('a');
        link.href = data.link.url;
        link.target = '_blank';
        root.append(link);
        document.body.append(root);
        stop = followFileHost(page, root, data);
        return { page, parent, link };
    }

    function message(data: unknown, source: unknown, origin = AGENT): MessageEvent {
        const event = new MessageEvent('message', { data, origin });
        Object.defineProperty(event, 'source', { value: source });
        return event;
    }

    function click(link: HTMLElement, init: MouseEventInit = {}): MouseEvent {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        link.dispatchEvent(event);
        return event;
    }

    it('names the Report app in the Book, with the report’s state', () => {
        expect(openInReportUrl('https://bkper.app', OPEN)).toBe(
            'https://bkper.app/books/book-1/transactions?app=report&appState=1MF9hLjIwMTcuLi4xOTEwMDI'
        );
    });

    it('asks the host to navigate on a click, only after it said it can', () => {
        const { page, parent, link } = filePage();

        expect(click(link).defaultPrevented).toBe(false);
        page.dispatchEvent(message(READY, parent));
        expect(parent.postMessage).not.toHaveBeenCalled();

        expect(click(link).defaultPrevented).toBe(true);
        expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith(
            { type: 'bkper:navigate', url: openInReportUrl('https://bkper.app', OPEN) },
            AGENT
        );
    });

    it('keeps the plain link for modified clicks, other hosts and other messages', () => {
        const { page, parent, link } = filePage();
        const stranger = { postMessage: vi.fn() };
        page.dispatchEvent(message(READY, stranger));
        page.dispatchEvent(message({ ...READY, supports: ['app-state'] }, parent));
        page.dispatchEvent(message({ ...READY, origin: 'javascript:alert(1)' }, parent));
        page.dispatchEvent(message({ ...READY, origin: 'https://bkper.app/books' }, parent));
        page.dispatchEvent(message({ ...READY, origin: undefined }, parent));
        page.dispatchEvent(message(READY, parent, 'null'));
        page.dispatchEvent(message({ ...READY, type: 'bkper:app-url-changed' }, parent));
        expect(click(link).defaultPrevented).toBe(false);

        page.dispatchEvent(message(READY, parent));
        expect(click(link, { metaKey: true }).defaultPrevented).toBe(false);
        expect(click(link, { button: 1 }).defaultPrevented).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();
        expect(stranger.postMessage).not.toHaveBeenCalled();
    });

    it('stops when a later host-ready no longer lists navigate', () => {
        const { page, parent, link } = filePage();
        page.dispatchEvent(message(READY, parent));
        page.dispatchEvent(message({ ...READY, supports: [] }, parent));
        expect(click(link).defaultPrevented).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();
    });

    it('keeps the plain link for a report without state', () => {
        const { page, parent, link } = filePage({ link: LINK });
        page.dispatchEvent(message(READY, parent));
        expect(click(link).defaultPrevented).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();
    });

    it('leaves other links alone', () => {
        const { page, parent, link } = filePage();
        page.dispatchEvent(message(READY, parent));
        const other = document.createElement('a');
        other.href = 'https://bkper.app/b/#transactions';
        link.after(other);
        expect(click(other).defaultPrevented).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();
    });
});
