import { t } from 'report-shared/strings';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportResponse, Suggestion } from '../../../src/api/app-api';
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
        url: 'https://report.bkper.app/',
    };
}

function createPage(language = 'en'): ReportPage {
    const href = 'https://report.bkper.app/?book=book-1';
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
    const api: ReportApi = {
        suggestions: async () => SUGGESTIONS,
        report: async () => report('Net result'),
    };
    const state = new AppState({
        page,
        embedded: false,
        language,
        createAuthSession: () => ({
            authenticatedFetch: async () => new Response(),
            getAccessToken: () => 'token',
            init: async () => undefined,
            login: () => undefined,
            refresh: async () => undefined,
        }),
        createReportApi: () => api,
        loadRenderer: async () => undefined,
        logger: { error: () => undefined },
    });
    const view = new ReportPage();
    view.state = state;
    document.body.append(view);
    return view;
}

function shadow(view: ReportPage): ShadowRoot {
    if (!view.shadowRoot) throw new Error('The page has not rendered');
    return view.shadowRoot;
}

describe('ReportPage', () => {
    afterEach(() => document.body.replaceChildren());

    it('renders one labeled input and no submit button', async () => {
        const view = createPage();
        await view.updateComplete;

        const input = shadow(view).querySelector('wa-input');
        expect(input?.getAttribute('label')).toBe('Report request');
        expect(input?.getAttribute('placeholder')).toContain('Describe a report');
        expect(shadow(view).querySelectorAll('wa-button')).toHaveLength(1);
        expect(shadow(view).querySelector('wa-button')?.textContent).toContain('Books');
    });

    it('writes the interface in the language of the person once its strings load', async () => {
        const view = createPage('es');
        view.state.connect();
        await view.updateComplete;
        await view.state.strings.load();
        await view.updateComplete;

        const input = shadow(view).querySelector('wa-input');
        expect(input?.getAttribute('label')).toBe(t('input_label', 'es'));
        expect(input?.getAttribute('label')).not.toBe('Report request');
    });

    it('shows the suggestions under the empty input and the report a suggestion asks for', async () => {
        const view = createPage();
        view.state.reports.open('book-1');
        await new Promise(resolve => setTimeout(resolve));
        await view.updateComplete;

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
