import { t } from 'report-shared/strings';
import { afterEach, describe, expect, it } from 'vitest';
import { AppApiError, type ReportResponse, type Suggestion } from '../../../src/api/app-api';
import '../../../src/web-awesome';
import { ReportPage } from '../../../src/components/report-page/report-page-view';
import '../../../src/report/index';
import { CHOOSE_SUGGESTION } from '../../../src/components/report-suggestions';
import { AppState } from '../../../src/state/app-state';
import type { ReportApi } from '../../../src/state/reports';
import type { RoutePage } from '../../../src/state/route';

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
        chart: { kind: 'none', fallback: false },
        url: 'https://report.bkper.app/',
    };
}

function createPage(
    options: {
        language?: string;
        href?: string;
        content?: HTMLElement;
        api?: ReportApi;
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
            if (child.matches('slot, report-view, report-suggestions, .notice, wa-input')) {
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
        expect(layout(view)).toEqual(['slot', 'report-suggestions', 'wa-input']);

        view.state.reports.choose(SUGGESTIONS[0]);
        await settle(view);
        expect(layout(view)).toEqual(['slot', 'report-view', 'wa-input']);

        view.state.reports.fail('hint_not_a_report');
        await view.updateComplete;
        expect(layout(view)).toEqual([
            'slot',
            'report-view',
            'notice',
            'report-suggestions',
            'wa-input',
        ]);
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

        const suggestions = shadow(view).querySelector('report-suggestions');
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
        expect(shadow(view).querySelector('report-suggestions')).toBeNull();
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
