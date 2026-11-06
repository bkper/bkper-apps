/**
 * A report file's script: it renders the report the file carries (`ReportFileData`, in its JSON
 * script) in the file's `<report-view>`, in the viewer's light or dark color scheme. It reads
 * nothing else and loads nothing. Where the host lets it navigate, such as the Bkper Agent in a
 * Book, its link opens the same report in the Report app in place (`followFileHost`).
 */
import { REPORT_FILE_DATA_ID, type ReportFileData } from 'report-shared/report-file';
import { plainClick, readHostReady } from '../bkper-host.js';
import type { ReportView } from '../report/index.js';

/** The Report app's id in Bkper, which a Book URL names to open it. */
const REPORT_APP_ID = 'report';

/** The window around the file, as far as the file talks to it. */
export interface FileParent {
    postMessage(message: unknown, targetOrigin: string): void;
}

/** The file's own window: the browser's, or a double in tests. */
export interface FilePage extends EventTarget {
    readonly parent: FileParent;
}

/** The part of a `MediaQueryList` the color scheme needs. */
export interface ColorScheme extends EventTarget {
    readonly matches: boolean;
}

/** Applies Web Awesome's dark theme while `dark` matches, as it changes. */
export function followColorScheme(root: Element, dark: ColorScheme): void {
    const apply = () => root.classList.toggle('wa-dark', dark.matches);
    apply();
    dark.addEventListener('change', apply);
}

/**
 * Renders the report of the document; the view, or `undefined` without one or its data. With
 * `page`, its window, the link follows the host (`followFileHost`).
 */
export function startReportFile(
    document: Document,
    dark: ColorScheme,
    page?: FilePage
): ReportView | undefined {
    followColorScheme(document.documentElement, dark);
    const view = document.querySelector('report-view');
    const text = document.getElementById(REPORT_FILE_DATA_ID)?.textContent;
    if (!view || !text) {
        return undefined;
    }
    // The Worker wrote the data from a spec it validated.
    const data: ReportFileData = JSON.parse(text);
    view.spec = data.spec;
    view.link = data.link;
    if (page) followFileHost(page, document, data);
    return view;
}

/** The Book page that opens the Report app with a report's state, on the Bkper `origin`. */
export function openInReportUrl(origin: string, open: NonNullable<ReportFileData['open']>): string {
    const url = new URL(`/books/${encodeURIComponent(open.bookId)}/transactions`, origin);
    url.searchParams.set('app', REPORT_APP_ID);
    url.searchParams.set('appState', open.state);
    return url.href;
}

/**
 * Once the window around the file says it accepts `bkper:navigate` and names the Bkper origin
 * (`bkper:host-ready`, as the Bkper Agent tells the files it shows), a plain click on the
 * file's link asks it to open the same report in the Report app in the Book, in place, instead
 * of a new tab. Until then, and for a report without state, the link stays a plain link. Only
 * the parent window's messages count, and only a click sends anything. Returns a function that
 * stops following.
 */
export function followFileHost(
    page: FilePage,
    root: EventTarget,
    data: Pick<ReportFileData, 'link' | 'open'>
): () => void {
    const open = data.open;
    if (!open) return () => undefined;
    const link = new URL(data.link.url).href;
    /** The Bkper origin to open, and the origin of the window that said so. */
    let host: { bkper: string; parent: string } | undefined;
    const onMessage = (event: Event) => {
        if (!(event instanceof MessageEvent) || event.source !== page.parent) return;
        const ready = readHostReady(event.data);
        if (!ready) return;
        const bkper = ready.origin;
        // The link goes only to the window that named the origin, which checks it again (the
        // Agent opens only its own Bkper), so any web origin will do; the file names none.
        const navigable =
            ready.supports.includes('navigate') &&
            bkper !== undefined &&
            isWebOrigin(bkper) &&
            event.origin !== 'null' &&
            event.origin !== '';
        host = navigable ? { bkper, parent: event.origin } : undefined;
    };
    const onClick = (event: Event) => {
        if (!host || !(event instanceof MouseEvent) || !plainClick(event)) return;
        const anchor = event
            .composedPath()
            .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
        if (anchor?.href !== link) return;
        event.preventDefault();
        page.parent.postMessage(
            { type: 'bkper:navigate', url: openInReportUrl(host.bkper, open) },
            host.parent
        );
    };
    page.addEventListener('message', onMessage);
    root.addEventListener('click', onClick);
    return () => {
        page.removeEventListener('message', onMessage);
        root.removeEventListener('click', onClick);
    };
}

/** An `http:` or `https:` origin, written as its origin alone. */
function isWebOrigin(origin: string): boolean {
    try {
        const url = new URL(origin);
        return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === origin;
    } catch {
        return false;
    }
}
