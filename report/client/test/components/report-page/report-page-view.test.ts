import { t } from 'report-shared/strings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppApiError, type ReportResponse, type Suggestion } from '../../../src/api/app-api';
import '../../../src/web-awesome';
import { ReportPage } from '../../../src/components/report-page/report-page-view';
import { SELECT_CHART } from '../../../src/report/index';
import { CHOOSE_SUGGESTION } from '../../../src/components/report-suggestions';
import { AppState } from '../../../src/state/app-state';
import type { ReportApi } from '../../../src/state/reports';
import type { RoutePage } from '../../../src/state/route';
import type { SavedReportsApi } from '../../../src/state/saved-reports';

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
        suggestions: async () => SUGGESTIONS,
        report: async () => report('Net result'),
    };
    const state = new AppState({
        page,
        embedded: false,
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
        createBookService: () => ({
            listBooksDirect: async () => [],
            getBook: options.getBook ?? (async () => ({ id: 'book-1', name: 'Main Book' })),
        }),
        loadRenderer: async () => undefined,
        logger: { error: () => undefined },
    });
    const view = new ReportPage();
    view.state = state;
    if (options.content) view.append(options.content);
    document.body.append(view);
    return view;
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

const WRITE = { list: true, save: true, remove: true };
const ITEM = { id: 'a'.repeat(64), prompt: 'Expenses this year' };
function emptyShelf(): SavedReportsApi {
    return {
        savedReports: async () => ({ reports: [], capabilities: WRITE }),
        saveReport: async (_book, body) => ({ id: ITEM.id, prompt: body.prompt }),
        removeReport: async () => undefined,
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

    it('opens a saved prompt through a new prompt request on every click, including suggestions', async () => {
        const request = vi.fn<ReportApi['report']>(async () => report('Fresh'));
        const view = createPage({
            api: { suggestions: async () => SUGGESTIONS, report: request },
            shelfApi: {
                ...emptyShelf(),
                savedReports: async () => ({
                    reports: [{ ...ITEM, prompt: SUGGESTIONS[0].text }],
                    capabilities: WRITE,
                }),
            },
        });
        await ready(view);
        request.mockClear();
        control(view, '.saved-prompt').click();
        await settle(view);
        control(view, '.saved-prompt').click();
        await settle(view);
        expect(request).toHaveBeenCalledTimes(2);
        for (const call of request.mock.calls)
            expect(call[1]).toEqual({ prompt: SUGGESTIONS[0].text });
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
                    capabilities: { list: true, save: false, remove: false },
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
