import { t } from 'report-shared/strings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AppApiError,
    type BookName,
    type BookProblem,
    type ReportResponse,
    type Suggestion,
} from '../../../src/api/app-api';
import '../../../src/web-awesome';
import { ReportPage } from '../../../src/components/report-page/report-page-view';
import { SELECT_CHART } from '../../../src/report/index';
import { CHOOSE_SUGGESTION } from '../../../src/components/report-suggestions';
import { AppState } from '../../../src/state/app-state';
import { CACHE_MS } from '../../../src/state/cache-window';
import { DEBOUNCE_MS, type ReportApi } from '../../../src/state/reports';
import type { RoutePage } from '../../../src/state/route';
import type { SavedReportsApi } from '../../../src/state/saved-reports';
import type { BookNamesApi } from '../../../src/state/book-names';
import type { HostPage } from '../../../src/state/book-host';

beforeEach(() => vi.stubGlobal('matchMedia', window.matchMedia.bind(window)));
afterEach(() => vi.unstubAllGlobals());

const SUGGESTIONS: Suggestion[] = [
    { text: 'Net result in 2011', intent: { root: 'net-result', period: '2011', monthly: false } },
];

function report(title: string): ReportResponse {
    return {
        spec: {
            root: 'report',
            elements: {
                report: {
                    type: 'Report',
                    props: { title, subtitle: '2011', locale: 'en', dir: 'ltr', fractionDigits: 2 },
                    children: [],
                },
            },
        },
        intent: SUGGESTIONS[0].intent,
        language: 'en',
        query: 'q',
        dataAt: '2026-11-05T00:00:00Z',
        chart: { kind: 'bar', fallback: false },
        trace: {
            facts: {
                rows: 2,
                negative: 0,
                mixed: false,
                months: 12,
                previous: true,
                net: false,
                permanent: false,
            },
            chart: { fitting: ['bar', 'pie', 'table'], main: 'bar', rule: 'rules' },
        },
        url: 'https://report.bkper.app/',
    };
}

function createPage(
    options: {
        language?: string;
        href?: string;
        content?: HTMLElement;
        api?: ReportApi;
        shelfApi?: SavedReportsApi;
        getBook?: () => Promise<{ id: string; name: string }>;
        now?: () => number;
        names?: BookName[];
        namesApi?: BookNamesApi;
        embedded?: boolean;
        host?: HostPage;
    } = {}
): ReportPage {
    const href = options.href ?? 'https://report.bkper.app/?book=book-1';
    const page: RoutePage = {
        location: { href },
        history: {
            state: null,
            pushState: (_data, _unused, url) => void (page.location.href = String(url)),
            replaceState: (_data, _unused, url) => void (page.location.href = String(url)),
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
    const api: ReportApi = options.api ?? {
        suggestions: async () => ({ suggestions: SUGGESTIONS }),
        report: async () => report('Net result'),
    };
    const state = new AppState({
        page,
        embedded: options.embedded ?? false,
        host: options.host ?? createHostPage('https://report.bkper.app'),
        language: options.language ?? 'en',
        createAuthSession: () => ({
            authenticatedFetch: async () => new Response(),
            getAccessToken: () => 'token',
            init: async () => undefined,
            login: () => undefined,
            refresh: async () => undefined,
        }),
        createReportApi: () => api,
        createSavedReportsApi: () => options.shelfApi ?? emptyShelf(),
        createBookNamesApi: () => options.namesApi ?? { names: async () => options.names ?? [] },
        createBookService: () => ({
            listBooksDirect: async () => [],
            getBook: options.getBook ?? (async () => ({ id: 'book-1', name: 'Main Book' })),
        }),
        loadRenderer: async () => undefined,
        logger: { error: () => undefined },
        now: options.now,
    });
    const view = new ReportPage();
    view.state = state;
    if (options.content) view.append(options.content);
    document.body.append(view);
    return view;
}

/** The page as a Book around it talks to it; its own parent when standalone. */
function createHostPage(origin: string, parent?: HostPage['parent']) {
    const page = Object.assign(new EventTarget(), { location: { origin } });
    Object.defineProperty(page, 'parent', { value: parent ?? page });
    return page as HostPage;
}

function shadow(view: ReportPage): ShadowRoot {
    if (!view.shadowRoot) throw new Error('The page has not rendered');
    return view.shadowRoot;
}

function input(view: ReportPage) {
    const field = shadow(view).querySelector('wa-input');
    if (!field) throw new Error('The page has no input');
    return field;
}

/** The elements of the page in reading order, by class, tag or slot. */
function layout(view: ReportPage): string[] {
    const page = shadow(view).querySelector('.page');
    const names: string[] = [];
    const walk = (element: Element) => {
        for (const child of Array.from(element.children)) {
            if (child.matches('slot, report-view, report-shelf, .notice, wa-input')) {
                names.push(child.matches('.notice') ? 'notice' : child.localName);
            } else walk(child);
        }
    };
    if (page) walk(page);
    return names;
}

const settle = async (view: ReportPage) => {
    await new Promise(resolve => setTimeout(resolve));
    await view.updateComplete;
    await view.updateComplete;
};

describe('ReportPage', () => {
    afterEach(() => document.body.replaceChildren());

    it('renders one labeled pill input that sends on Enter, and no button', async () => {
        const view = createPage();
        await view.updateComplete;

        const field = input(view);
        expect(field.getAttribute('label')).toBe('Report request');
        expect(field.getAttribute('placeholder')).toContain('Describe a report');
        expect(field.hasAttribute('pill')).toBe(true);
        expect(field.getAttribute('enterkeyhint')).toBe('send');
        expect(field.disabled).toBe(false);
        expect(shadow(view).querySelectorAll('wa-button')).toHaveLength(0);
    });

    it('shows no Book picker and no breadcrumb inside a Book', async () => {
        const view = createPage();
        view.state.books.bookName = 'Main Book';
        await view.updateComplete;

        const text = shadow(view).textContent ?? '';
        expect(text).not.toContain(t('books_back', 'en'));
        expect(text).not.toContain('Main Book');
        expect(shadow(view).querySelector('book-picker')).toBeNull();
    });

    it('keeps the input at the bottom, under the report, the notices and the suggestions', async () => {
        const view = createPage();
        view.state.reports.open('book-1');
        await settle(view);
        expect(layout(view)).toEqual(['slot', 'report-shelf', 'wa-input']);

        view.state.reports.choose(SUGGESTIONS[0]);
        await settle(view);
        expect(layout(view)).toEqual(['slot', 'report-view', 'report-shelf', 'wa-input']);

        view.state.reports.fail('hint_not_a_report');
        await view.updateComplete;
        expect(layout(view)).toEqual(['slot', 'report-view', 'notice', 'report-shelf', 'wa-input']);
    });

    it('focuses the input when it first renders inside a Book', async () => {
        const view = createPage();
        await view.updateComplete;
        await input(view).updateComplete;
        await view.updateComplete;

        expect(shadow(view).activeElement).toBe(input(view));
    });

    it('shows the first report of a Book it opens with its request selected, the focus kept in the input', async () => {
        const view = createPage();
        await ready(view);

        const field = input(view).input;
        expect(view.state.reports.text).toBe(SUGGESTIONS[0].text);
        expect(field?.value).toBe(SUGGESTIONS[0].text);
        expect([field?.selectionStart, field?.selectionEnd]).toEqual([
            0,
            SUGGESTIONS[0].text.length,
        ]);
        expect(shadow(view).activeElement).toBe(input(view));
        expect(shadow(view).querySelector('report-view')).not.toBeNull();
    });

    it('shows what it is given above a disabled input without a Book', async () => {
        const picker = document.createElement('book-picker');
        const view = createPage({ href: 'https://report.bkper.app/', content: picker });
        await view.updateComplete;

        expect(layout(view)).toEqual(['slot', 'wa-input']);
        const slot = shadow(view).querySelector('slot');
        expect(slot?.assignedElements()).toEqual([picker]);
        expect(input(view).disabled).toBe(true);
        expect(shadow(view).activeElement).toBeNull();
    });

    it('writes the interface in the language and direction of the person', async () => {
        const view = createPage({ language: 'ar' });
        view.state.connect();
        await view.updateComplete;
        await view.state.strings.load();
        await view.updateComplete;

        expect(input(view).getAttribute('label')).toBe(t('input_label', 'ar'));
        const page = shadow(view).querySelector('.page');
        expect(page?.getAttribute('lang')).toBe('ar');
        expect(page?.getAttribute('dir')).toBe('rtl');
    });

    it('shows the suggestions over the empty input and the report a suggestion asks for', async () => {
        const view = createPage();
        view.state.reports.open('book-1');
        await settle(view);

        const suggestions = shelfRoot(view).querySelector('report-suggestions');
        expect(suggestions?.suggestions).toEqual(SUGGESTIONS);
        suggestions?.dispatchEvent(
            new CustomEvent(CHOOSE_SUGGESTION, {
                detail: SUGGESTIONS[0],
                bubbles: true,
                composed: true,
            })
        );
        await view.updateComplete;
        await view.updateComplete;

        expect(view.state.reports.text).toBe('Net result in 2011');
        expect(shelfRoot(view).querySelector('report-suggestions')).not.toBeNull();
        expect(shadow(view).querySelector('report-view')?.spec).toEqual(report('Net result').spec);
    });

    it('asks at once on Enter, and Escape clears the request', async () => {
        const view = createPage();
        view.state.reports.open('book-1');
        await settle(view);
        view.state.reports.input('net result');

        input(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(view.state.reports.pending).toBe(true);
        await settle(view);
        expect(shadow(view).querySelector('report-view')).not.toBeNull();

        input(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await view.updateComplete;
        expect(view.state.reports.text).toBe('');
        expect(view.state.route.prompt).toBe('');
    });

    it('clears the request with the clear button, and has no chart glyph', async () => {
        const view = createPage();
        view.state.reports.open('book-1');
        await settle(view);
        const field = input(view);
        expect(field.withClear).toBe(true);
        expect(field.querySelector('svg')).toBeNull();

        view.state.reports.input('net result');
        await view.updateComplete;
        await field.updateComplete;
        const clear = field.shadowRoot?.querySelector<HTMLButtonElement>('[part~="clear-button"]');
        expect(clear).not.toBeNull();
        clear?.click();
        await field.updateComplete;
        await settle(view);

        expect(view.state.reports.text).toBe('');
        expect(view.state.route.prompt).toBe('');
    });

    it('keeps the chart chosen in the report, and shows it in the report', async () => {
        const view = createPage();
        view.state.reports.open('book-1');
        view.state.reports.input('net result');
        view.state.reports.submit();
        await settle(view);
        const shown = shadow(view).querySelector('report-view');
        expect(shown?.chart).toBeUndefined();

        shown?.dispatchEvent(
            new CustomEvent(SELECT_CHART, {
                detail: { kind: 'pie' },
                bubbles: true,
                composed: true,
            })
        );
        await settle(view);

        expect(view.state.reports.chart).toBe('pie');
        expect(shown?.chart).toBe('pie');
    });

    it('changes into the next report in a transition that captures it once its chart has drawn', async () => {
        const view = createPage({
            api: {
                suggestions: async () => ({ suggestions: SUGGESTIONS }),
                report: async (_book, body) =>
                    report('prompt' in body && body.prompt === 'taxes' ? 'Taxes' : 'Net result'),
            },
        });
        view.state.reports.open('book-1');
        view.state.reports.input('net result');
        view.state.reports.submit();
        await settle(view);
        const shown = shadow(view).querySelector('report-view');
        if (!shown) throw new Error('No report');
        // A browser with view transitions scoped to an element, and a chart still to draw. The
        // transition runs on the scroll area, never larger than the screen: a whole tall report
        // is captured smaller than it is, then shown scaled up.
        const drawn = deferred<void>();
        let captured: Promise<void> | undefined;
        let onReport = false;
        Object.assign(shown, {
            chartDrawn: () => drawn.promise,
            startViewTransition: () => {
                onReport = true;
                throw new Error('Scoped to the whole report');
            },
        });
        const area = shadow(view).querySelector('.scroll');
        if (!area) throw new Error('No scroll area');
        Object.assign(area, {
            startViewTransition: (update: () => Promise<void>) => {
                captured = update();
                return {
                    updateCallbackDone: captured,
                    ready: captured,
                    finished: captured,
                    skipTransition: () => undefined,
                };
            },
        });

        view.state.reports.input('taxes');
        view.state.reports.submit();
        await settle(view);
        let done = false;
        void captured?.then(() => (done = true));
        await settle(view);

        expect(captured).toBeDefined();
        expect(onReport).toBe(false);
        expect(shown.spec).toEqual(report('Taxes').spec);
        expect(done).toBe(false);
        drawn.resolve();
        await captured;
        expect(done).toBe(true);
    });

    it('does not wait for the chart where the transition holds the whole page', async () => {
        const view = createPage({
            api: {
                suggestions: async () => ({ suggestions: SUGGESTIONS }),
                report: async (_book, body) =>
                    report('prompt' in body && body.prompt === 'taxes' ? 'Taxes' : 'Net result'),
            },
        });
        view.state.reports.open('book-1');
        view.state.reports.input('net result');
        view.state.reports.submit();
        await settle(view);
        const shown = shadow(view).querySelector('report-view');
        if (!shown) throw new Error('No report');
        // Only document transitions: nothing draws until the next page is captured.
        let captured: Promise<void> | undefined;
        Object.assign(shown, { chartDrawn: () => new Promise<void>(() => undefined) });
        Object.assign(document, {
            startViewTransition: (update: () => Promise<void>) => {
                captured = update();
                return {
                    updateCallbackDone: captured,
                    ready: captured,
                    finished: captured,
                    skipTransition: () => undefined,
                };
            },
        });
        try {
            view.state.reports.input('taxes');
            view.state.reports.submit();
            await settle(view);
            await captured;

            expect(captured).toBeDefined();
            expect(shown.spec).toEqual(report('Taxes').spec);
        } finally {
            Reflect.deleteProperty(document, 'startViewTransition');
        }
    });

    it('shows a quiet hint, or a clear alert when something failed', async () => {
        const view = createPage();
        view.state.reports.fail('hint_not_a_report');
        await view.updateComplete;
        expect(shadow(view).querySelector('.notice')?.getAttribute('role')).toBe('status');

        view.state.reports.fail('error_ai_allowance_exhausted');
        await view.updateComplete;
        const alert = shadow(view).querySelector('.notice');
        expect(alert?.getAttribute('role')).toBe('alert');
        expect(alert?.textContent).toContain('Bkper AI allowance');
    });

    it('shows one clear error for a Book that cannot be read', async () => {
        const notFound = new AppApiError('Not found', 404, 'book_not_found');
        const view = createPage({
            api: {
                suggestions: async () => Promise.reject(notFound),
                report: async () => Promise.reject(notFound),
            },
            getBook: async () => Promise.reject(new Error('Book NOT found!')),
        });
        void view.state.books.select('book-1');
        view.state.reports.open('book-1');
        await settle(view);

        const notices = shadow(view).querySelectorAll('.notice');
        expect(notices).toHaveLength(1);
        expect(notices[0].getAttribute('role')).toBe('alert');
        expect(notices[0].textContent?.trim()).toBe(t('error_book_not_found', 'en'));
    });

    it('says the Book did not load when nothing more precise is known', async () => {
        const view = createPage({ getBook: async () => Promise.reject(new Error('offline')) });
        await view.state.books.select('book-1');
        await view.updateComplete;

        const notices = shadow(view).querySelectorAll('.notice');
        expect(notices).toHaveLength(1);
        expect(notices[0].getAttribute('role')).toBe('alert');
        expect(notices[0].textContent?.trim()).toBe(t('error_book_load', 'en'));
    });

    it('shows the progress line only while a report is on its way', async () => {
        const view = createPage();
        await view.updateComplete;
        expect(shadow(view).querySelector('wa-progress-bar')?.classList.contains('active')).toBe(
            false
        );

        view.state.reports.pending = true;
        await view.updateComplete;
        expect(shadow(view).querySelector('wa-progress-bar')?.classList.contains('active')).toBe(
            true
        );
    });
});

const WRITE = { list: true, save: true, remove: true, move: true };
const ITEM = { id: 'a'.repeat(64), prompt: 'Expenses this year' };
function emptyShelf(): SavedReportsApi {
    return {
        savedReports: async () => ({ reports: [], capabilities: WRITE }),
        saveReport: async (_book, body) => ({ id: ITEM.id, prompt: body.prompt }),
        removeReport: async () => undefined,
        moveReport: async () => ({ reports: [], capabilities: WRITE }),
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function shelfRoot(view: ReportPage): ShadowRoot {
    const root = shadow(view).querySelector('report-shelf')?.shadowRoot;
    if (!root) throw new Error('The shelf has not rendered');
    return root;
}
function control(view: ReportPage, selector: string) {
    const button = shelfRoot(view).querySelector<HTMLElementTagNameMap['wa-button']>(selector);
    if (!button) throw new Error(`Missing shelf control: ${selector}`);
    return button;
}
async function ready(view: ReportPage) {
    view.state.select('book-1');
    await settle(view);
}
async function run(view: ReportPage, prompt = 'My original request') {
    view.state.reports.input(prompt);
    view.state.reports.submit();
    await settle(view);
}

describe('Book-shared prompt shelf in ReportPage', () => {
    afterEach(() => document.body.replaceChildren());

    it('replaces initial suggestions with saved prompts, kept during typing, reports and errors', async () => {
        const loaded = deferred<Awaited<ReturnType<SavedReportsApi['savedReports']>>>();
        const view = createPage({
            shelfApi: { ...emptyShelf(), savedReports: () => loaded.promise },
        });
        view.state.select('book-1');
        await settle(view);
        expect(shelfRoot(view).querySelector('report-suggestions')).not.toBeNull();
        expect(shelfRoot(view).querySelector('[role="status"]')?.textContent).toContain(
            t('shelf_loading', 'en')
        );
        loaded.resolve({ reports: [ITEM], capabilities: WRITE });
        await settle(view);
        expect(shelfRoot(view).querySelector('report-suggestions')).toBeNull();
        expect(control(view, '.saved-prompt').textContent).toContain(ITEM.prompt);
        await run(view);
        view.state.reports.input('later draft');
        view.state.reports.pending = true;
        await settle(view);
        expect(control(view, '.saved-prompt').getAttribute('aria-label')).toBe(ITEM.prompt);
        view.state.reports.fail('error_upstream');
        await settle(view);
        expect(control(view, '.saved-prompt').getAttribute('aria-label')).toBe(ITEM.prompt);
        expect(layout(view).at(-2)).toBe('report-shelf');
    });

    it('opens a saved prompt by its text, from memory within a minute, even matching a suggestion', async () => {
        const request = vi.fn<ReportApi['report']>(async () => report('Fresh'));
        const clock = { now: 1_000_000 };
        const view = createPage({
            now: () => clock.now,
            api: { suggestions: async () => ({ suggestions: SUGGESTIONS }), report: request },
            shelfApi: {
                ...emptyShelf(),
                savedReports: async () => ({
                    reports: [{ ...ITEM, prompt: SUGGESTIONS[0].text }],
                    capabilities: WRITE,
                }),
            },
        });
        const prompts = () => request.mock.calls.filter(call => call[1].prompt !== undefined);
        // The Book opens its first saved prompt, as a click does: by its text.
        await ready(view);
        expect(prompts()).toHaveLength(1);
        control(view, '.saved-prompt').click();
        await settle(view);
        control(view, '.saved-prompt').click();
        await settle(view);
        expect(prompts()).toHaveLength(1);
        clock.now += CACHE_MS;
        control(view, '.saved-prompt').click();
        await settle(view);
        expect(prompts().map(call => call[1])).toEqual([
            { prompt: SUGGESTIONS[0].text },
            { prompt: SUGGESTIONS[0].text },
        ]);
        expect(shadow(view).activeElement).toBe(input(view));
    });

    it('saves the shown original prompt with one click, not the later draft, and prevents duplicates', async () => {
        const saved = deferred<typeof ITEM>();
        const save = vi.fn((_book: string, _body: { prompt: string }) => saved.promise);
        const view = createPage({ shelfApi: { ...emptyShelf(), saveReport: save } });
        await ready(view);
        await run(view);
        view.state.reports.chooseChart('pie');
        view.state.reports.input('An unsent later draft');
        await settle(view);
        control(view, '.save').click();
        await settle(view);
        expect(save.mock.calls[0].slice(0, 2)).toEqual([
            'book-1',
            { prompt: 'My original request' },
        ]);
        expect(control(view, '.save').loading).toBe(true);
        expect(control(view, '.save').disabled).toBe(true);
        control(view, '.save').click();
        expect(save).toHaveBeenCalledTimes(1);
        saved.resolve({ ...ITEM, prompt: 'My original request' });
        await settle(view);
        expect(control(view, '.saved-prompt').textContent).toContain('My original request');
        expect(control(view, '.save').textContent).toContain(t('shelf_saved', 'en'));
        expect(control(view, '.save').disabled).toBe(true);
        expect(shelfRoot(view).querySelector('report-suggestions')).toBeNull();
    });

    it('shows safe save failure feedback and retries on Save without losing the shelf', async () => {
        const save = vi
            .fn()
            .mockRejectedValueOnce(new Error('private token details'))
            .mockResolvedValue(ITEM);
        const view = createPage({ shelfApi: { ...emptyShelf(), saveReport: save } });
        await ready(view);
        await run(view, ITEM.prompt);
        control(view, '.save').click();
        await settle(view);
        expect(shelfRoot(view).querySelector('[role="alert"]')?.textContent).toContain(
            t('shelf_save_error', 'en')
        );
        expect(shelfRoot(view).textContent).not.toContain('private token');
        expect(control(view, '.save').disabled).toBe(false);
        control(view, '.save').click();
        await settle(view);
        expect(save).toHaveBeenCalledTimes(2);
        expect(shelfRoot(view).querySelector('[role="alert"]')).toBeNull();
        expect(control(view, '.saved-prompt').textContent).toContain(ITEM.prompt);
    });

    it('removes only on confirmation from the API and leaves a failed item available to retry', async () => {
        const removed = deferred<void>();
        const remove = vi
            .fn()
            .mockRejectedValueOnce(new Error('private'))
            .mockReturnValueOnce(removed.promise);
        const view = createPage({
            shelfApi: {
                ...emptyShelf(),
                savedReports: async () => ({ reports: [ITEM], capabilities: WRITE }),
                removeReport: remove,
            },
        });
        await ready(view);
        control(view, '.remove').click();
        await settle(view);
        expect(shelfRoot(view).querySelector('[role="alert"]')?.textContent).toContain(
            t('shelf_remove_error', 'en')
        );
        expect(control(view, '.saved-prompt')).toBeDefined();
        control(view, '.remove').click();
        await settle(view);
        expect(control(view, '.remove').loading).toBe(true);
        expect(control(view, '.remove').disabled).toBe(true);
        expect(shelfRoot(view).querySelector('[role="status"]')?.textContent).toContain(
            t('shelf_removing', 'en')
        );
        expect(control(view, '.saved-prompt')).toBeDefined();
        removed.resolve();
        await settle(view);
        expect(shelfRoot(view).querySelector('.saved-prompt')).toBeNull();
        expect(shelfRoot(view).querySelector('report-suggestions')).not.toBeNull();
    });

    it('uses returned read-only capabilities and offers no mutation controls', async () => {
        const view = createPage({
            shelfApi: {
                ...emptyShelf(),
                savedReports: async () => ({
                    reports: [ITEM],
                    capabilities: { list: true, save: false, remove: false, move: false },
                }),
            },
        });
        await ready(view);
        await run(view);
        expect(control(view, '.saved-prompt').disabled).toBe(false);
        expect(shelfRoot(view).querySelector('.save')).toBeNull();
        expect(shelfRoot(view).querySelector('.remove')).toBeNull();
    });

    it('does not offer Save for a restored intent or a prefetched suggestion', async () => {
        const view = createPage();
        await ready(view);
        view.state.reports.choose(SUGGESTIONS[0]);
        await settle(view);
        expect(shelfRoot(view).querySelector('.save')).toBeNull();
        view.state.reports.openState({ intent: SUGGESTIONS[0].intent, language: 'en' });
        await settle(view);
        expect(shelfRoot(view).querySelector('.save')).toBeNull();
    });

    it('recovers a failed shelf load explicitly, without hiding the report or input', async () => {
        const load = vi
            .fn()
            .mockRejectedValueOnce(new AppApiError('private', 502, 'storage_error'))
            .mockResolvedValue({ reports: [ITEM], capabilities: WRITE });
        const view = createPage({ shelfApi: { ...emptyShelf(), savedReports: load } });
        await ready(view);
        await run(view);
        expect(shelfRoot(view).querySelector('[role="alert"]')?.textContent).toContain(
            t('shelf_load_error', 'en')
        );
        expect(shadow(view).querySelector('report-view')).not.toBeNull();
        expect(input(view).disabled).toBe(false);
        control(view, '.reload').click();
        await settle(view);
        expect(control(view, '.saved-prompt')).toBeDefined();
        expect(shelfRoot(view).querySelector('[role="alert"]')).toBeNull();
    });

    it('drops old pending saves and stale shelf controls on Book switches and exit', async () => {
        const saved = deferred<typeof ITEM>();
        const view = createPage({ shelfApi: { ...emptyShelf(), saveReport: () => saved.promise } });
        await ready(view);
        await run(view);
        control(view, '.save').click();
        view.state.select('book-2');
        await settle(view);
        saved.resolve(ITEM);
        await settle(view);
        expect(shelfRoot(view).querySelector('.saved-prompt')).toBeNull();
        expect(shelfRoot(view).querySelector('.save')).toBeNull();
        view.state.select(undefined);
        await settle(view);
        expect(shadow(view).querySelector('report-shelf')).toBeNull();
    });

    it('disables Save until the report on screen catches up with a transition', async () => {
        const view = createPage();
        await ready(view);
        await run(view);
        const shelf = shadow(view).querySelector('report-shelf');
        if (!shelf) throw new Error('Missing shelf');
        shelf.current = false;
        await shelf.updateComplete;
        expect(control(view, '.save').disabled).toBe(true);
        shelf.current = true;
        await shelf.updateComplete;
        expect(control(view, '.save').disabled).toBe(false);
    });

    it('rechecks access after server denial and never trusts the old mutation capabilities', async () => {
        const save = vi.fn().mockRejectedValue(new AppApiError('private', 403, 'forbidden'));
        const view = createPage({ shelfApi: { ...emptyShelf(), saveReport: save } });
        await ready(view);
        await run(view);
        control(view, '.save').click();
        await settle(view);
        expect(shelfRoot(view).querySelector('.save')).toBeNull();
        expect(shelfRoot(view).querySelector('.remove')).toBeNull();
        expect(shelfRoot(view).querySelector('[role="alert"]')?.textContent).toContain(
            t('shelf_access_error', 'en')
        );
        control(view, '.reload').click();
        await settle(view);
        expect(control(view, '.save').disabled).toBe(false);
        expect(shelfRoot(view).querySelector('[role="alert"]')).toBeNull();
    });

    it('hides old shelf data on Book switching even when the new list is still loading', async () => {
        const load = deferred<Awaited<ReturnType<SavedReportsApi['savedReports']>>>();
        const view = createPage({
            shelfApi: {
                ...emptyShelf(),
                savedReports: book =>
                    book === 'book-1'
                        ? Promise.resolve({ reports: [ITEM], capabilities: WRITE })
                        : load.promise,
            },
        });
        await ready(view);
        view.state.select('book-2');
        await settle(view);
        expect(shelfRoot(view).querySelector('.saved-prompt')).toBeNull();
        expect(shelfRoot(view).querySelector('.remove')).toBeNull();
        expect(shelfRoot(view).querySelector('.save')).toBeNull();
        expect(shelfRoot(view).querySelector('[role="status"]')?.textContent).toContain(
            t('shelf_loading', 'en')
        );
        load.resolve({ reports: [], capabilities: WRITE });
        await settle(view);
    });

    it('keeps full multilingual labels accessible without deriving a title', async () => {
        const prompt = 'المصروفات this year 日本語 '.repeat(25);
        const view = createPage({
            language: 'ar',
            shelfApi: {
                ...emptyShelf(),
                savedReports: async () => ({ reports: [{ ...ITEM, prompt }], capabilities: WRITE }),
            },
        });
        await ready(view);
        expect(control(view, '.saved-prompt').getAttribute('aria-label')).toBe(prompt);
        expect(control(view, '.saved-prompt').getAttribute('title')).toBe(prompt);
        expect(control(view, '.saved-prompt').querySelector('bdi')?.textContent).toBe(prompt);
        expect(control(view, '.remove').getAttribute('aria-label')).toContain(prompt);
    });
});

const NAMES: BookName[] = [
    { id: 'g-exp', name: 'Despesas', kind: 'group', root: 'g-exp' },
    { id: 'g-dev', name: 'Dívidas', kind: 'group', root: 'g-dev' },
    { id: 'a-food', name: 'Refeições', kind: 'account', root: 'g-exp' },
    { id: 'a-card', name: 'Credit Card', kind: 'account', root: 'g-dev' },
    { id: 'a-car', name: 'Car', kind: 'account', root: 'g-exp' },
    { id: 'a-cash', name: 'Cash', kind: 'account', root: 'g-exp' },
];

/** The `<input>` inside the page's `wa-input`. */
function native(view: ReportPage): HTMLInputElement {
    const field = input(view).shadowRoot?.querySelector('input');
    if (!field) throw new Error('The input has not rendered');
    return field;
}

/** Type `marked` into the input, its caret at `|` (else at the end), as the browser does. */
async function type(view: ReportPage, marked: string, composing = false) {
    const caret = marked.includes('|') ? marked.indexOf('|') : marked.length;
    const field = native(view);
    field.value = marked.replace('|', '');
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(
        new InputEvent('input', { bubbles: true, composed: true, isComposing: composing })
    );
    await view.updateComplete;
}

function press(view: ReportPage, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        composed: true,
        cancelable: true,
        ...init,
    });
    native(view).dispatchEvent(event);
    return event;
}

function listbox(view: ReportPage) {
    return shadow(view).querySelector<HTMLElement>('[role="listbox"]');
}

function options(view: ReportPage): HTMLElement[] {
    return Array.from(shadow(view).querySelectorAll<HTMLElement>('[role="option"]'));
}

/** Each option offered: its name, then its kind, as read. */
function offered(view: ReportPage): string[] {
    return options(view).map(option => option.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** The input's text with `|` at its caret. */
function caretText(view: ReportPage): string {
    const field = native(view);
    const at = field.selectionStart ?? field.value.length;
    return `${field.value.slice(0, at)}|${field.value.slice(at)}`;
}

async function completing(names = NAMES, language = 'en') {
    const report = vi.fn<ReportApi['report']>(async () => reportOf('Despesas'));
    const view = createPage({
        names,
        language,
        api: { suggestions: async () => ({ suggestions: SUGGESTIONS }), report },
    });
    await ready(view);
    await view.state.names.loaded;
    await input(view).updateComplete;
    native(view).focus();
    report.mockClear();
    return { view, report };
}

function reportOf(title: string): ReportResponse {
    return report(title);
}

describe('Completing Book names in ReportPage', () => {
    afterEach(() => document.body.replaceChildren());

    it('lists the names completing the word at the caret, as a listbox the input controls', async () => {
        const { view } = await completing();
        const field = native(view);
        expect(field.getAttribute('role')).toBe('combobox');
        expect(field.getAttribute('aria-autocomplete')).toBe('list');
        expect(field.getAttribute('aria-expanded')).toBe('false');

        await type(view, 'despesas com ca');

        expect(offered(view)).toEqual(['Car Account', 'Cash Account', 'Credit Card Account']);
        expect(listbox(view)?.getAttribute('aria-label')).toBe(t('completion_label', 'en'));
        expect(field.getAttribute('aria-expanded')).toBe('true');
        expect(field.ariaControlsElements).toEqual([listbox(view)]);
        // Nothing is highlighted until the person browses: Enter still runs the report.
        expect(field.ariaActiveDescendantElement).toBeNull();
        expect(options(view).map(option => option.getAttribute('aria-selected'))).toEqual([
            'false',
            'false',
            'false',
        ]);
        expect(shadow(view).querySelector('wa-popup')?.active).toBe(true);
    });

    it('tells a Group from an Account, in the interface language, names in their own direction', async () => {
        const { view } = await completing(NAMES, 'ar');
        await view.state.strings.load();
        await type(view, 'تقرير de');

        const [option] = options(view);
        expect(option.querySelector('bdi')?.textContent).toBe('Despesas');
        expect(option.textContent).toContain(t('completion_group', 'ar'));
        expect(t('completion_group', 'ar')).not.toBe(t('completion_group', 'en'));
        await type(view, 'تقرير refe');
        expect(options(view)[0].textContent).toContain(t('completion_account', 'ar'));
        expect(shadow(view).querySelector('.page')?.getAttribute('dir')).toBe('rtl');
    });

    it('shows nothing before two characters, after a space or for no real match', async () => {
        const { view } = await completing();
        for (const text of ['c', 'despesas ', 'ash', 'despesas #ca', 'ca|sh']) {
            await type(view, text);
            expect(offered(view), text).toEqual([]);
            expect(native(view).getAttribute('aria-expanded')).toBe('false');
        }
    });

    it('browses with the arrow keys and accepts the highlighted name on Enter, without running the report', async () => {
        const { view, report } = await completing();
        await type(view, 'despesas com ca');

        expect(press(view, 'ArrowDown').defaultPrevented).toBe(true);
        await view.updateComplete;
        expect(native(view).ariaActiveDescendantElement).toBe(options(view)[0]);
        expect(options(view)[0].getAttribute('aria-selected')).toBe('true');
        press(view, 'ArrowDown');
        press(view, 'ArrowDown');
        press(view, 'ArrowDown');
        await view.updateComplete;
        expect(native(view).ariaActiveDescendantElement).toBe(options(view)[0]);
        press(view, 'ArrowUp');
        await view.updateComplete;
        expect(native(view).ariaActiveDescendantElement).toBe(options(view)[2]);

        expect(press(view, 'Enter').defaultPrevented).toBe(true);
        await view.updateComplete;

        expect(caretText(view)).toBe('despesas com Credit Card |');
        expect(view.state.reports.text).toBe('despesas com Credit Card ');
        expect(view.state.route.prompt).toBe('despesas com Credit Card ');
        expect(offered(view)).toEqual([]);
        expect(native(view).getAttribute('aria-expanded')).toBe('false');
        expect(native(view).ariaActiveDescendantElement).toBeNull();
        expect(report).not.toHaveBeenCalled();
        expect(view.state.reports.pending).toBe(false);
    });

    it('runs the report on Enter when no name is highlighted, and closes the list', async () => {
        const { view, report } = await completing();
        await type(view, 'despesas com ca');

        expect(press(view, 'Enter').defaultPrevented).toBe(false);
        await view.updateComplete;

        expect(report).toHaveBeenCalledWith(
            'book-1',
            { prompt: 'despesas com ca' },
            expect.anything()
        );
        expect(view.state.reports.text).toBe('despesas com ca');
        expect(offered(view)).toEqual([]);
    });

    it('accepts the first name, or the highlighted one, on Tab; Tab moves on when nothing shows', async () => {
        const { view } = await completing();
        await type(view, 'despesas com ca');
        expect(press(view, 'Tab').defaultPrevented).toBe(true);
        await view.updateComplete;
        expect(caretText(view)).toBe('despesas com Car |');

        await type(view, 'despesas com Car e refe');
        press(view, 'ArrowDown');
        press(view, 'Tab');
        await view.updateComplete;
        expect(caretText(view)).toBe('despesas com Car e Refeições |');

        expect(press(view, 'Tab').defaultPrevented).toBe(false);
        await type(view, 'despesas com ca');
        expect(press(view, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    });

    it('accepts a name on click or tap, keeping the focus and the rest of the request', async () => {
        const { view } = await completing();
        await type(view, 'despesas com refe| em 2026, #viagem');
        expect(offered(view)).toEqual(['Refeições Account']);

        const option = options(view)[0];
        const down = new MouseEvent('mousedown', {
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        option.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        const pointer = new Event('pointerdown', {
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        option.dispatchEvent(pointer);
        expect(pointer.defaultPrevented).toBe(true);
        option.click();
        await view.updateComplete;

        expect(caretText(view)).toBe('despesas com Refeições| em 2026, #viagem');
        expect(view.state.reports.text).toBe('despesas com Refeições em 2026, #viagem');
        expect(shadow(view).activeElement).toBe(input(view));
    });

    it('completes several names in one request, wherever the caret is', async () => {
        const { view } = await completing();
        await type(view, 'cred');
        press(view, 'Tab');
        await view.updateComplete;
        await type(view, `${native(view).value}e refei`);
        press(view, 'Tab');
        await view.updateComplete;
        expect(caretText(view)).toBe('Credit Card e Refeições |');

        await type(view, 'Credit Card e Refeições versus div| em 2026');
        press(view, 'Tab');
        await view.updateComplete;
        expect(caretText(view)).toBe('Credit Card e Refeições versus Dívidas| em 2026');
    });

    it('lets the debounce run the report of the request a name completed', async () => {
        const { view, report } = await completing();
        await type(view, 'despesas com refe');
        press(view, 'Tab');
        await new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS + 50));

        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][1]).toEqual({ prompt: 'despesas com Refeições' });
    });

    it('dismisses the names on Escape first, then clears the request as before', async () => {
        const { view } = await completing();
        await type(view, 'despesas com ca');

        expect(press(view, 'Escape').defaultPrevented).toBe(true);
        await view.updateComplete;
        expect(offered(view)).toEqual([]);
        expect(view.state.reports.text).toBe('despesas com ca');

        // Focusing again does not bring them back; typing does.
        native(view).dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
        await view.updateComplete;
        expect(offered(view)).toEqual([]);

        press(view, 'Escape');
        await view.updateComplete;
        expect(view.state.reports.text).toBe('');
        expect(view.state.route.prompt).toBe('');

        await type(view, 'despesas com ca');
        expect(offered(view)).toHaveLength(3);
    });

    it('waits for an input method to finish composing before completing or handling keys', async () => {
        const { view, report } = await completing();
        // Composition events: happy-dom has no CompositionEvent, and nothing here reads its data.
        native(view).dispatchEvent(
            new Event('compositionstart', { bubbles: true, composed: true })
        );
        await type(view, 'despesas com ca', true);
        expect(offered(view)).toEqual([]);
        // An input while composing completes nothing, even when the event does not say so.
        await type(view, 'despesas com ca');
        expect(offered(view)).toEqual([]);

        native(view).dispatchEvent(new Event('compositionend', { bubbles: true, composed: true }));
        await view.updateComplete;
        expect(offered(view)).toHaveLength(3);

        // The Enter that confirms a composition neither accepts nor runs anything.
        press(view, 'ArrowDown');
        const confirm = press(view, 'Enter', { isComposing: true });
        const safari = press(view, 'Enter', { keyCode: 229 });
        await view.updateComplete;
        expect(confirm.defaultPrevented || safari.defaultPrevented).toBe(false);
        expect(view.state.reports.text).toBe('despesas com ca');
        expect(report).not.toHaveBeenCalled();
        expect(offered(view)).toHaveLength(3);
    });

    it('follows the caret, and closes when the input loses focus', async () => {
        const { view } = await completing();
        await type(view, 'ca e refe');
        expect(offered(view)).toEqual(['Refeições Account']);

        native(view).setSelectionRange(2, 2);
        native(view).dispatchEvent(
            new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true, composed: true })
        );
        await view.updateComplete;
        expect(offered(view)).toEqual(['Car Account', 'Cash Account', 'Credit Card Account']);

        native(view).setSelectionRange(0, 2);
        input(view).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        await view.updateComplete;
        expect(offered(view)).toEqual([]);

        await type(view, 'ca e refe');
        native(view).dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
        await view.updateComplete;
        expect(offered(view)).toEqual([]);
    });

    it('keeps the clear button and the shelf working, closing the names when the request changes elsewhere', async () => {
        const { view } = await completing();
        await type(view, 'despesas com ca');
        const shelf = shadow(view).querySelector('report-shelf');
        expect(shelf?.contains(listbox(view))).toBe(false);
        expect(shelf?.shadowRoot?.querySelector('[role="listbox"]')).toBeNull();

        const field = input(view);
        await field.updateComplete;
        field.shadowRoot?.querySelector<HTMLButtonElement>('[part~="clear-button"]')?.click();
        await field.updateComplete;
        await settle(view);
        expect(view.state.reports.text).toBe('');
        expect(offered(view)).toEqual([]);

        await type(view, 'despesas com ca');
        view.state.reports.choose(SUGGESTIONS[0]);
        await settle(view);
        expect(offered(view)).toEqual([]);
        expect(native(view).getAttribute('aria-expanded')).toBe('false');
    });

    it('offers the names that arrive while typing', async () => {
        const names = deferred<BookName[]>();
        const view = createPage({ namesApi: { names: () => names.promise } });
        await ready(view);
        await input(view).updateComplete;
        native(view).focus();
        await type(view, 'despesas com ca');
        expect(offered(view)).toEqual([]);

        names.resolve(NAMES);
        await view.state.names.loaded;
        await view.updateComplete;
        await view.updateComplete;
        expect(offered(view)).toHaveLength(3);
    });
});

describe('ReportPage with a Book whose groups keep it from reports', () => {
    afterEach(() => document.body.replaceChildren());

    const BASE = { bookName: 'Acme Ltd', canOrganize: true };
    const NOTHING: BookProblem = {
        ...BASE,
        code: 'nothing_to_report',
        ungrouped: 12,
        total: 15,
    };

    /** A page whose Book has `problem` when it opens, as its suggestions say. */
    function openWith(
        problem: BookProblem,
        options: Parameters<typeof createPage>[0] = {}
    ): ReportPage {
        return createPage({
            ...options,
            api: {
                suggestions: async () => ({ suggestions: [], problem }),
                report: async () =>
                    Promise.reject(
                        new AppApiError('Problem', 422, problem.code, undefined, problem)
                    ),
            },
        });
    }

    function problemOf(view: ReportPage) {
        const element = shadow(view).querySelector('.problem');
        if (!element) throw new Error('No problem shows');
        const action = element.querySelector('wa-button');
        return { element, text: element.textContent?.replace(/\s+/g, ' ').trim(), action };
    }

    it('says an empty Book has nothing yet, and starts it with the Agent, with no request', async () => {
        const view = openWith({ ...BASE, code: 'empty_book' });
        view.state.reports.open('book-1');
        await settle(view);

        const { text, action } = problemOf(view);
        expect(text).toContain(t('problem_empty_book', 'en'));
        expect(action?.textContent?.trim()).toBe(t('action_agent_start', 'en'));
        const url = new URL(action?.getAttribute('href') ?? '');
        expect(url.href).toBe('https://bkper.app/books/book-1/transactions?app=bkper-agent');
        expect(url.searchParams.has('q')).toBe(false);
        // Standalone, the link opens Bkper in the same tab.
        expect(action?.hasAttribute('target')).toBe(false);
        expect(shadow(view).querySelectorAll('.notice')).toHaveLength(1);
    });

    it('offers to organize the Book with the Agent, with the request ready', async () => {
        const view = openWith(NOTHING);
        view.state.reports.open('book-1');
        await settle(view);

        const { text, action } = problemOf(view);
        expect(text).toContain('12 of its 15 accounts');
        expect(action?.textContent?.trim()).toBe(t('action_agent_organize', 'en'));
        const url = new URL(action?.getAttribute('href') ?? '');
        expect(url.origin + url.pathname).toBe('https://bkper.app/books/book-1/transactions');
        expect(url.searchParams.get('app')).toBe('bkper-agent');
        expect(url.searchParams.get('q')).toBe(
            'My Book "Acme Ltd" has nothing to report on: 12 of its 15 accounts with transactions are in no group. Help me organize them into groups for reports, such as a balance sheet and an income statement. Change groups only, not transactions.'
        );
    });

    it('links to Bkper in production from the preview app, which production opens for developers', async () => {
        const view = openWith(NOTHING, {
            host: createHostPage('https://report-preview.bkper.app'),
        });
        view.state.reports.open('book-1');
        await settle(view);

        const href = problemOf(view).action?.getAttribute('href') ?? '';
        expect(new URL(href).origin).toBe('https://bkper.app');
    });

    it('tells others to ask the Book’s owner, with no action', async () => {
        for (const [problem, ask] of [
            [{ ...BASE, canOrganize: false, code: 'empty_book' }, 'problem_ask_owner_start'],
            [{ ...NOTHING, canOrganize: false }, 'problem_ask_owner'],
        ] as const) {
            const view = openWith(problem);
            view.state.reports.open('book-1');
            await settle(view);

            const { text, action } = problemOf(view);
            expect(text).toContain(t(ask, 'en'));
            expect(action).toBeNull();
            expect(view.state.agentLink(problem)).toBeUndefined();
            view.remove();
        }
    });

    it('says what keeps the report asked for, with the groups involved', async () => {
        const problems: BookProblem[] = [
            { ...BASE, code: 'mixed_group', group: 'Everything' },
            {
                ...BASE,
                code: 'no_net_result',
                incoming: ['Revenue'],
                outgoing: ['Costs'],
                shared: ['Revenue', 'Costs'],
            },
        ];
        let next = problems[0];
        const view = createPage({
            api: {
                suggestions: async () => ({ suggestions: SUGGESTIONS }),
                report: async () =>
                    Promise.reject(new AppApiError('Problem', 422, next.code, undefined, next)),
            },
        });
        view.state.reports.open('book-1');
        await settle(view);
        expect(shadow(view).querySelector('.problem')).toBeNull();

        view.state.reports.input('everything this year');
        view.state.reports.submit();
        await settle(view);
        let shown = problemOf(view);
        expect(shown.text).toContain('Everything');
        expect(shown.text).toContain('holds both balances');
        const mixed = new URL(shown.action?.getAttribute('href') ?? '');
        expect(mixed.searchParams.get('q')).toContain('the group Everything combines');

        next = problems[1];
        view.state.reports.input('net result this year');
        view.state.reports.submit();
        await settle(view);
        shown = problemOf(view);
        expect(shown.text).toContain('share accounts');
        const shared = new URL(shown.action?.getAttribute('href') ?? '');
        expect(shared.searchParams.get('q')).toContain('its groups Revenue and Costs share');

        view.state.reports.input('expenses this year');
        await view.updateComplete;
        expect(shadow(view).querySelector('.problem')).toBeNull();
    });

    it('opens the Agent in place in a Book that navigates for the app', async () => {
        const parent = { postMessage: vi.fn() };
        const host = createHostPage('https://report.bkper.app', parent);
        const view = openWith(NOTHING, { embedded: true, host });
        view.state.connect();
        view.state.reports.open('book-1');
        await settle(view);

        // Until the Book says it navigates, the link opens in a new tab.
        const { action } = problemOf(view);
        expect(action?.getAttribute('target')).toBe('_blank');
        const early = new MouseEvent('click', { bubbles: true, cancelable: true });
        action?.dispatchEvent(early);
        expect(early.defaultPrevented).toBe(false);
        expect(parent.postMessage).not.toHaveBeenCalled();

        const ready = new MessageEvent('message', {
            data: { type: 'bkper:host-ready', supports: ['navigate'] },
            origin: 'https://dev.bkper.app',
        });
        Object.defineProperty(ready, 'source', { value: parent });
        host.dispatchEvent(ready);

        const modified = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            metaKey: true,
        });
        action?.dispatchEvent(modified);
        expect(modified.defaultPrevented).toBe(false);

        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        action?.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        // On the Book's own origin, with the same request.
        const url = new URL(action?.getAttribute('href') ?? '');
        expect(url.origin).toBe('https://bkper.app');
        expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith(
            {
                type: 'bkper:navigate',
                url: `https://dev.bkper.app${url.pathname}${url.search}`,
            },
            'https://dev.bkper.app'
        );
        view.state.disconnect();
    });
});
