import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    EXPAND_ROW,
    OPEN_IN_BKPER,
    ReportView,
    SELECT_CHART,
    type ExpandRowDetail,
    type ReportSpec,
    type SelectChartDetail,
} from '../../src/report/index';
import { ReportFormat } from '../../src/report/format';
import { elementOf, galleryIds, gallerySpec } from './gallery-specs';

const views: ReportView[] = [];

beforeAll(() => {
    // happy-dom has no canvas, so Chart.js cannot draw; the tests read the charts' configuration.
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        if (!String(args[0]).startsWith('Failed to create chart')) {
            error(...args);
        }
    });
});

afterEach(() => {
    views.splice(0).forEach(view => view.remove());
});

async function mount(spec: ReportSpec): Promise<ReportView> {
    const view = document.createElement('report-view');
    view.spec = spec;
    document.body.append(view);
    views.push(view);
    await view.updateComplete;
    return view;
}

function root(view: ReportView): ShadowRoot {
    if (!view.shadowRoot) {
        throw new Error('The report has no shadow root');
    }
    return view.shadowRoot;
}

function text(view: ReportView, selector: string): string[] {
    return [...root(view).querySelectorAll(selector)].map(node => node.textContent?.trim() ?? '');
}

function row(view: ReportView, id: string): HTMLTableRowElement {
    const found = root(view).querySelector<HTMLTableRowElement>(`tr[data-row="${id}"]`);
    if (!found) {
        throw new Error(`No row ${id}`);
    }
    return found;
}

function barColors(view: ReportView): unknown {
    const chart = root(view).querySelector('wa-bar-chart');
    if (!chart) {
        throw new Error('No bar chart');
    }
    return chart.config.data.datasets[0].backgroundColor;
}

describe('<report-view>', () => {
    it('renders every recorded spec, answer first with the previews beside it, then chart, table and source', async () => {
        for (const id of galleryIds()) {
            const spec = gallerySpec(id);
            const view = await mount(spec);
            const classes = (selector: string) =>
                [...root(view).querySelectorAll(selector)].map(node => node.className);
            // Targets side by side have an Answer each, together.
            const answers = Object.values(spec.elements).filter(
                element => element.type === 'Answer'
            ).length;
            expect(classes('.report-intro > *'), id).toEqual([
                'report-header',
                answers > 1 ? 'answers' : 'answer',
            ]);
            // The previews share the header's row, beside the title, so its end is not left empty.
            const top = ['report-intro'];
            if (Object.values(spec.elements).some(element => element.type === 'Visualizations')) {
                top.push('previews');
            }
            expect(classes('.report-top > *'), id).toEqual(top);
            const expected = ['report-top'];
            if (Object.values(spec.elements).some(element => element.type === 'Chart')) {
                expected.push(expect.stringContaining('chart'));
            }
            // A report of an account has no table: an account has no parts.
            if (Object.values(spec.elements).some(element => element.type === 'BreakdownTable')) {
                expected.push('breakdown-section');
            }
            expect(classes('.report > *'), id).toEqual([...expected, 'source']);
        }
    });

    it('shows a report of an account without a table of parts, and of a group with its own', async () => {
        const account = await mount(gallerySpec('rent-account-by-month'));
        expect(root(account).querySelector('.breakdown-section')).toBeNull();
        expect(root(account).querySelector('.report-header h1')?.textContent).toBe('Rent');
        expect(root(account).querySelector('.chart')).not.toBeNull();
        const group = await mount(gallerySpec('banks-target-today'));
        expect(root(group).querySelector('.report-header h1')?.textContent).toBe('Banks');
        expect(root(group).querySelectorAll('.breakdown-section tbody tr')).toHaveLength(1);
    });

    it('shows targets side by side, an answer each in order, and no total', async () => {
        const view = await mount(gallerySpec('targets-by-month'));
        const answers = root(view).querySelectorAll('.answers > .answer');
        expect([...answers].map(answer => answer.getAttribute('aria-label'))).toEqual([
            'People',
            'Office',
            'Taxes',
        ]);
        expect(text(view, '.answers .answer-label')).toEqual(['People', 'Office', 'Taxes']);
        expect(text(view, '.answers .answer-amount')).toHaveLength(3);
        expect(root(view).querySelector('.breakdown tfoot')).toBeNull();
        expect(text(view, '.breakdown > tbody > tr.row:not(.child) .row-label')).toEqual([
            'People',
            'Office',
            'Taxes',
        ]);
        // Each target's series, told apart though all are expenses.
        const chart = root(view).querySelector('wa-bar-chart');
        const colors = chart?.config.data.datasets.map(dataset => dataset.backgroundColor);
        expect(new Set(colors).size).toBe(3);
    });

    it('draws every chart kind with its Web Awesome chart, and no chart for a table', async () => {
        const drawn: Record<string, string> = {
            'revenue-donut': 'wa-doughnut-chart',
            'revenue-donut-ja': 'wa-doughnut-chart',
            'expenses-stacked': 'wa-bar-chart',
            'bank-accounts-area': 'wa-line-chart',
            'expenses-compare': 'wa-bar-chart[orientation="horizontal"]',
        };
        for (const [id, selector] of Object.entries(drawn)) {
            const view = await mount(gallerySpec(id));
            expect(root(view).querySelector(`.chart > ${selector}`), id).not.toBeNull();
        }
        const table = await mount(gallerySpec('expenses-table'));
        expect(root(table).querySelector('.chart')).toBeNull();
        expect(root(table).querySelector('.breakdown-section')).not.toBeNull();
    });

    it('shows the swatches of a donut and of a stacked chart in the table', async () => {
        for (const id of ['revenue-donut', 'expenses-stacked']) {
            const view = await mount(gallerySpec(id));
            expect(root(view).querySelectorAll('tbody .swatch').length, id).toBeGreaterThan(1);
        }
    });

    it('formats amounts and ratios in the report locale', async () => {
        const spec = gallerySpec('net-result-by-month-pt');
        const view = await mount(spec);
        expect(text(view, '.answer-amount')).toEqual(['50.371,36']);
        expect(text(view, '.answer-comparison .change')).toEqual(['+148,1%']);
        expect(text(view, 'tbody td.amount')).toEqual(['400.724,18', '290.865,53', '59.487,29']);
    });

    it('totals the roots of a net result Report calculates, and says Report calculated it', async () => {
        const spec = gallerySpec('net-result-by-month-pt');
        const view = await mount(spec);
        const answer = elementOf(spec, 'Answer').props;
        const format = new ReportFormat('pt-BR', 2);
        expect(text(view, '.answer-part')).toEqual([]);
        expect(text(view, 'tfoot th')).toEqual([elementOf(spec, 'Report').props.title]);
        expect(text(view, 'tfoot td.amount')).toEqual([format.amount(answer.amount)]);
        expect(text(view, 'tfoot td.change')).toEqual([format.change(answer.change ?? '')]);
        expect(root(view).querySelectorAll('tfoot wa-sparkline')).toHaveLength(1);
        const calculated = elementOf(spec, 'Source').props.calculated;
        expect(calculated).toBeDefined();
        expect(text(view, '.source-calculated dt')).toEqual([calculated?.label]);
        expect(text(view, '.source-calculated dd')).toEqual([calculated?.note]);
        // Not hidden in the Source's Details, which start closed.
        expect(root(view).querySelector('.source-details .source-calculated')).toBeNull();
        expect(root(view).querySelector('.source-calculated')?.closest('[hidden]')).toBeNull();
        // Bkper's own amounts say nothing of the kind.
        const group = await mount(gallerySpec('net-result-group'));
        expect(text(group, '.source-calculated')).toEqual([]);
    });

    it('lists a row without amount in the table, after the rows the chart draws', async () => {
        const spec = gallerySpec('taxes-donut');
        const view = await mount(spec);
        const rows = [...root(view).querySelectorAll('tbody tr')].map(node =>
            node.getAttribute('data-row')
        );
        expect(rows).toEqual(['a-income-tax', 'a-payroll-tax', 'a-sales-tax', 'a-property-tax']);
        expect(row(view, 'a-property-tax').querySelector('.swatch')).toBeNull();
        expect(row(view, 'a-income-tax').querySelector('.swatch')).not.toBeNull();
    });

    it('says under the title what the report could not do as asked, and only then', async () => {
        const spec = gallerySpec('taxes-donut');
        expect(text(await mount(spec), '.report-notice')).toEqual([]);
        const report = spec.elements[spec.root];
        if (report.type !== 'Report') throw new Error('No Report');
        const notice = 'The comparison asked for cannot be made, so this compares with 2024.';
        const view = await mount({
            ...spec,
            elements: {
                ...spec.elements,
                [spec.root]: { ...report, props: { ...report.props, notice } },
            },
        });
        expect(text(view, '.report-header .report-notice')).toEqual([notice]);
        expect(root(view).querySelector('.report-notice')?.getAttribute('role')).toBe('note');
    });

    it('formats in Japanese and lays out Arabic right to left', async () => {
        const ja = await mount(gallerySpec('revenue-donut-ja'));
        expect(root(ja).querySelector('.report')?.getAttribute('lang')).toBe('ja');
        expect(text(ja, '.subtitle')).toEqual(['2025年']);

        const ar = await mount(gallerySpec('expenses-breakdown-ar'));
        const article = root(ar).querySelector('.report');
        expect(article?.getAttribute('dir')).toBe('rtl');
        expect(article?.getAttribute('lang')).toBe('ar-EG');
        expect(text(ar, '.answer-amount')).toEqual(['٢٦٬٢٧٣٫٥٨']);
        expect(root(ar).querySelector('wa-bar-chart')?.getAttribute('dir')).toBe('rtl');
    });

    it('opens a row in place, announces it, and closes it again', async () => {
        const view = await mount(gallerySpec('expenses-breakdown'));
        const events: ExpandRowDetail[] = [];
        document.body.addEventListener(EXPAND_ROW, event => events.push(event.detail));
        const toggle = row(view, 'g-people').querySelector('button');
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        expect(root(view).querySelector('tr[data-row="a-salaries"]')).toBeNull();

        toggle?.click();
        await view.updateComplete;
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        const rows = [...root(view).querySelectorAll('tbody tr')].map(node =>
            node.getAttribute('data-row')
        );
        expect(rows.slice(0, 4)).toEqual(['g-people', 'a-salaries', 'a-contractors', 'a-benefits']);

        toggle?.click();
        await view.updateComplete;
        expect(root(view).querySelector('tr[data-row="a-salaries"]')).toBeNull();
        expect(events).toEqual([
            { rowId: 'g-people', expanded: true },
            { rowId: 'g-people', expanded: false },
        ]);
    });

    it('highlights the opened row in the chart until it closes', async () => {
        const view = await mount(gallerySpec('expenses-breakdown'));
        const plain = barColors(view);
        row(view, 'g-office').querySelector('button')?.click();
        await view.updateComplete;
        expect(row(view, 'g-office').classList.contains('highlighted')).toBe(true);
        expect(barColors(view)).toEqual(expect.arrayContaining(['var(--bkper-color-red-high)']));

        row(view, 'g-office').querySelector('button')?.click();
        await view.updateComplete;
        expect(barColors(view)).toEqual(plain);
    });

    it('highlights the hovered row in the chart, its group for a nested row', async () => {
        const view = await mount(gallerySpec('expenses-breakdown'));
        row(view, 'g-office').querySelector('button')?.click();
        await view.updateComplete;
        row(view, 'a-rent').dispatchEvent(new Event('pointerenter'));
        await view.updateComplete;
        expect(row(view, 'a-rent').classList.contains('highlighted')).toBe(true);
        expect(row(view, 'g-office').classList.contains('highlighted')).toBe(false);
        expect(barColors(view)).toEqual(expect.arrayContaining(['var(--bkper-color-red-high)']));

        root(view).querySelector('tbody')?.dispatchEvent(new Event('pointerleave'));
        await view.updateComplete;
        expect(row(view, 'g-office').classList.contains('highlighted')).toBe(true);
    });

    it('shows the Source on one line, its Details hidden until asked for', async () => {
        const spec = gallerySpec('expenses-by-month');
        const source = elementOf(spec, 'Source').props;
        const view = await mount(spec);
        const toggle = root(view).querySelector<HTMLButtonElement>('.source-line .source-toggle');
        const panel = root(view).querySelector<HTMLElement>('.source-details');
        expect(toggle?.textContent?.trim()).toBe(source.labels.details);
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        expect(toggle?.getAttribute('aria-controls')).toBe(panel?.id);
        expect(panel?.hidden).toBe(true);
        // The link to Bkper is on the same line, after Details.
        expect(text(view, '.source-line > *')).toEqual([source.labels.details, source.labels.open]);

        toggle?.click();
        await view.updateComplete;
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        expect(panel?.hidden).toBe(false);
        expect(text(view, '.source-details dt')).toEqual([
            source.labels.period,
            source.labels.query,
            source.labels.dataAt,
        ]);
        expect(text(view, '.source-details code')).toEqual([source.query]);
        expect(text(view, '.source-details .source-footer')).toEqual([source.footer]);

        // A changed report keeps them open, as it keeps rows open.
        view.spec = gallerySpec('taxes-donut');
        await view.updateComplete;
        expect(root(view).querySelector('.source-details')?.hasAttribute('hidden')).toBe(false);

        toggle?.click();
        await view.updateComplete;
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        expect(panel?.hidden).toBe(true);
    });

    it('names Details by the Source label in specs written before they had one', async () => {
        const spec = gallerySpec('expenses-by-month');
        const source = spec.elements.source;
        if (source?.type !== 'Source') {
            throw new Error('Expected a Source');
        }
        const { details: _details, ...labels } = source.props.labels;
        const view = await mount({
            ...spec,
            elements: {
                ...spec.elements,
                source: { ...source, props: { ...source.props, labels } },
            },
        });
        expect(text(view, '.source-toggle')).toEqual([source.props.labels.source]);
    });

    it('lets the host handle the link to Bkper', async () => {
        const spec = gallerySpec('expenses-by-month');
        const view = await mount(spec);
        const link = root(view).querySelector<HTMLAnchorElement>('.source a');
        expect(link?.getAttribute('href')).toBe(elementOf(spec, 'Source').props.url);
        const opened: string[] = [];
        const handle = (event: CustomEvent<{ url: string }>) => {
            opened.push(event.detail.url);
            event.preventDefault();
        };
        document.body.addEventListener(OPEN_IN_BKPER, handle);
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        link?.dispatchEvent(click);
        // A click that asks for a new tab or window is the browser's, not the host's.
        const modified = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
        });
        link?.dispatchEvent(modified);
        document.body.removeEventListener(OPEN_IN_BKPER, handle);
        expect(opened).toEqual([elementOf(spec, 'Source').props.url]);
        expect(click.defaultPrevented).toBe(true);
        expect(modified.defaultPrevented).toBe(false);
    });

    it('leaves the link out where the spec binds no openInBkper action', async () => {
        const spec = gallerySpec('expenses-by-month');
        const source = spec.elements.source;
        if (source?.type !== 'Source') {
            throw new Error('Expected a Source');
        }
        const view = await mount({
            ...spec,
            elements: { ...spec.elements, source: { type: 'Source', props: source.props } },
        });
        expect(root(view).querySelector('.source a')).toBeNull();
        expect(text(view, '.source code')).toEqual([elementOf(spec, 'Source').props.query]);
    });

    it('shows the plain link its host gives, without the action to Bkper', async () => {
        const spec = gallerySpec('expenses-by-month');
        const source = elementOf(spec, 'Source');
        const view = document.createElement('report-view');
        view.spec = {
            ...spec,
            elements: { ...spec.elements, source: { type: 'Source', props: source.props } },
        };
        view.link = { url: 'https://report.bkper.app/?book=b&q=expenses', label: 'Open in Report' };
        document.body.append(view);
        views.push(view);
        await view.updateComplete;
        const links = [...root(view).querySelectorAll<HTMLAnchorElement>('.source a')];
        expect(links.map(link => [link.getAttribute('href'), link.textContent?.trim()])).toEqual([
            ['https://report.bkper.app/?book=b&q=expenses', 'Open in Report'],
        ]);
        const opened: string[] = [];
        const handle = (event: CustomEvent<{ url: string }>) => opened.push(event.detail.url);
        document.body.addEventListener(OPEN_IN_BKPER, handle);
        const click = new Event('click', { bubbles: true, cancelable: true });
        links[0]?.dispatchEvent(click);
        document.body.removeEventListener(OPEN_IN_BKPER, handle);
        expect(opened).toEqual([]);
        expect(click.defaultPrevented).toBe(false);
    });

    it('shows the empty label when no row has balances', async () => {
        const view = await mount(gallerySpec('card-empty'));
        expect(text(view, '.breakdown-empty')).toEqual(['No balances in this period.']);
        expect(root(view).querySelector('table')).toBeNull();
    });
});

function previews(view: ReportView): HTMLButtonElement[] {
    return [...root(view).querySelectorAll<HTMLButtonElement>('.previews .preview')];
}

function preview(view: ReportView, kind: string): HTMLButtonElement {
    const found = root(view).querySelector<HTMLButtonElement>(`.preview[data-kind="${kind}"]`);
    if (!found) {
        throw new Error(`No preview of ${kind}`);
    }
    return found;
}

function shownKind(view: ReportView): string | null {
    return root(view).querySelector('.chart')?.getAttribute('data-kind') ?? null;
}

describe('<report-view> chart previews', () => {
    it('shows a live preview of every chart that fits, named, the one shown pressed', async () => {
        const spec = gallerySpec('expenses-by-month');
        const view = await mount(spec);
        const visualizations = elementOf(spec, 'Visualizations').props;
        const charts = visualizations.views.filter(entry => entry.kind !== 'table');
        expect(visualizations.views.some(entry => entry.kind === 'table')).toBe(true);
        expect(previews(view).map(button => button.dataset.kind)).toEqual(
            charts.map(entry => entry.kind)
        );
        expect(text(view, '.preview .preview-name')).toEqual(charts.map(entry => entry.name));
        expect(
            previews(view)
                .filter(button => button.getAttribute('aria-pressed') === 'true')
                .map(button => button.dataset.kind)
        ).toEqual(['bar']);
        expect(root(view).querySelector('.previews')?.getAttribute('aria-label')).toBe(
            visualizations.label
        );
        // Drawn from the numbers, with nothing to read in them.
        for (const button of previews(view)) {
            const drawing = button.querySelector('.thumb svg');
            expect(
                drawing?.querySelectorAll('rect, path, circle, polyline, line').length
            ).toBeGreaterThan(0);
            expect(drawing?.querySelector('text, title')).toBeNull();
        }
        const months = elementOf(spec, 'Chart').props;
        expect(months.kind).toBe('bar');
        const bars = preview(view, 'bar').querySelectorAll('.thumb rect');
        expect(bars.length).toBe('months' in months ? months.months.length : 0);
    });

    it('promotes a preview to the chart at once, with no network, and says so', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        const view = await mount(gallerySpec('expenses-by-month'));
        const chosen: SelectChartDetail[] = [];
        document.body.addEventListener(SELECT_CHART, event => chosen.push(event.detail));
        expect(shownKind(view)).toBe('bar');

        preview(view, 'donut').click();
        await view.updateComplete;

        expect(shownKind(view)).toBe('donut');
        expect(root(view).querySelector('.chart > wa-doughnut-chart')).not.toBeNull();
        expect(preview(view, 'donut').getAttribute('aria-pressed')).toBe('true');
        expect(preview(view, 'bar').getAttribute('aria-pressed')).toBe('false');
        expect(view.chart).toBe('donut');
        expect(chosen).toEqual([{ kind: 'donut' }]);
        // The table's swatches follow the chart shown.
        expect(root(view).querySelectorAll('tbody .swatch').length).toBeGreaterThan(1);

        expect(root(view).querySelector('.preview[data-kind="table"]')).toBeNull();
        expect(root(view).querySelector('.breakdown-section')).not.toBeNull();
        expect(fetch).not.toHaveBeenCalled();
        fetch.mockRestore();
    });

    it('draws a chart where the report shows only its table, once one is chosen', async () => {
        const view = await mount(gallerySpec('revenue-total'));
        expect(root(view).querySelector('.chart')).toBeNull();
        preview(view, 'donut').click();
        await view.updateComplete;
        expect(shownKind(view)).toBe('donut');
        // Right below the header's row, which holds the previews.
        const order = [...root(view).querySelectorAll('.report > *')].map(node => node.className);
        expect(order.indexOf('report-top')).toBe(
            order.findIndex(name => name.includes('chart')) - 1
        );
        expect(root(view).querySelector('.report-top > .previews')).not.toBeNull();
    });

    it('keeps table-only reports keyboard-accessible without a pressed preview', async () => {
        for (const id of ['expenses-table', 'revenue-total']) {
            const view = await mount(gallerySpec(id));
            expect(shownKind(view), id).toBeNull();
            expect(root(view).querySelector('.breakdown-section'), id).not.toBeNull();
            expect(root(view).querySelector('.preview[data-kind="table"]'), id).toBeNull();
            const buttons = previews(view);
            expect(buttons.length, id).toBeGreaterThan(0);
            expect(buttons.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(
                true
            );
            expect(buttons.map(button => button.tabIndex)).toEqual(
                buttons.map((_, index) => (index === 0 ? 0 : -1))
            );
            buttons[0].focus();
            buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            expect(root(view).activeElement).toBe(buttons.at(-1));
            buttons.at(-1)?.click();
            await view.updateComplete;
            expect(shownKind(view)).toBe(buttons.at(-1)?.dataset.kind);
            expect(previews(view).filter(button => button.tabIndex === 0)).toHaveLength(1);
        }
    });

    it('preserves a host-selected table-only view without a Table preview', async () => {
        const view = await mount(gallerySpec('expenses-by-month'));
        view.chart = 'table';
        await view.updateComplete;
        expect(shownKind(view)).toBeNull();
        expect(root(view).querySelector('.breakdown-section')).not.toBeNull();
        expect(root(view).querySelector('.preview[data-kind="table"]')).toBeNull();
        expect(previews(view).filter(button => button.tabIndex === 0)).toEqual([previews(view)[0]]);
    });

    it('shows the chart its host chooses, and the main one for a new report', async () => {
        const view = await mount(gallerySpec('expenses-by-month'));
        view.chart = 'compare';
        await view.updateComplete;
        expect(shownKind(view)).toBe('compare');

        view.spec = gallerySpec('expenses-breakdown');
        await view.updateComplete;
        expect(shownKind(view)).toBe('ranked-bar');

        // A chart the report does not offer shows the main one.
        view.chart = 'line';
        await view.updateComplete;
        expect(shownKind(view)).toBe('ranked-bar');
    });

    it('says under the title why the chart asked for does not fit, and offers no preview of it', async () => {
        const spec = gallerySpec('expenses-donut-negative');
        const view = await mount(spec);
        const notice = elementOf(spec, 'Report').props.notice;
        expect(notice).toContain('Food');
        expect(text(view, '.report-header .report-notice')).toEqual([notice]);
        expect(root(view).querySelector('.preview[data-kind="donut"]')).toBeNull();
        expect(root(view).querySelector('.preview[aria-disabled]')).toBeNull();
        expect(shownKind(view)).toBe('ranked-bar');
    });

    it('moves between previews with the arrow keys, in the report’s direction', async () => {
        for (const [id, forward] of [
            ['expenses-by-month', 'ArrowRight'],
            ['expenses-breakdown-ar', 'ArrowLeft'],
        ] as const) {
            const view = await mount(gallerySpec(id));
            const buttons = previews(view);
            const pressed = buttons.findIndex(b => b.getAttribute('aria-pressed') === 'true');
            // Only the chart shown is in the tab order; the arrows reach the others.
            expect(buttons.map(button => button.tabIndex)).toEqual(
                buttons.map((_, index) => (index === pressed ? 0 : -1))
            );
            buttons[pressed].focus();
            const key = (name: string) =>
                root(view).activeElement?.dispatchEvent(
                    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
                );
            key(forward);
            expect(root(view).activeElement, id).toBe(buttons[pressed + 1]);
            key('End');
            expect(root(view).activeElement, id).toBe(buttons.at(-1));
            key('Home');
            expect(root(view).activeElement, id).toBe(buttons[0]);
            // Moving does not choose.
            expect(shownKind(view), id).toBe(elementOf(gallerySpec(id), 'Chart').props.kind);
        }
    });

    it('offers no previews for a report that fits only its table', async () => {
        const view = await mount(gallerySpec('card-empty'));
        expect(root(view).querySelector('.previews')).toBeNull();
    });

    it('renders no empty toolbar when a compatible spec offers only the table', async () => {
        const spec = gallerySpec('expenses-table');
        const choices = elementOf(spec, 'Visualizations');
        const id = Object.keys(spec.elements).find(key => spec.elements[key] === choices);
        if (!id) throw new Error('No Visualizations');
        const view = await mount({
            ...spec,
            elements: {
                ...spec.elements,
                [id]: {
                    ...choices,
                    props: {
                        ...choices.props,
                        views: choices.props.views.filter(entry => entry.kind === 'table'),
                    },
                },
            },
        });
        expect(root(view).querySelector('.previews')).toBeNull();
        expect(root(view).querySelector('.chart')).toBeNull();
        expect(root(view).querySelector('.breakdown-section')).not.toBeNull();
    });

    it('offers no previews where the spec binds no selectChart action', async () => {
        const spec = gallerySpec('expenses-by-month');
        const visualizations = elementOf(spec, 'Visualizations');
        const id = Object.keys(spec.elements).find(key => spec.elements[key] === visualizations);
        if (!id) {
            throw new Error('No Visualizations');
        }
        const view = await mount({
            ...spec,
            elements: {
                ...spec.elements,
                [id]: { type: 'Visualizations', props: visualizations.props },
            },
        });
        expect(root(view).querySelector('.previews')).toBeNull();
        expect(shownKind(view)).toBe('bar');
    });
});

describe('<report-view> chartDrawn', () => {
    /** The chart element of the report, with the Chart.js chart it drew set by the test. */
    function chartOf(view: ReportView): HTMLElement & { chart: unknown } {
        const element = root(view).querySelector('.chart > *');
        if (!element) {
            throw new Error('No chart');
        }
        // happy-dom has no canvas, so Chart.js never draws; the test says when it has.
        Object.defineProperty(element, 'chart', { value: null, writable: true });
        return element as HTMLElement & { chart: unknown };
    }

    /** A Chart.js chart drawn at a size, as much of one as the chart element uses. */
    function drawing(width: number, height: number) {
        return { width, height, update: () => undefined, destroy: () => undefined };
    }

    it('resolves once the chart has drawn at the size of its element', async () => {
        const view = await mount(gallerySpec('expenses-by-month'));
        const element = chartOf(view);
        let drawn = false;
        const waiting = view.chartDrawn().then(() => (drawn = true));
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(drawn).toBe(false);
        // Drawn at the last chart's size, as Chart.js does before it fits the next one.
        element.chart = drawing(element.clientWidth, element.clientHeight + 112);
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(drawn).toBe(false);
        element.chart = drawing(element.clientWidth, element.clientHeight);
        await waiting;
        expect(drawn).toBe(true);
    });

    it('resolves at once without a chart, and in a few frames for one that never draws', async () => {
        const table = await mount(gallerySpec('expenses-table'));
        await expect(table.chartDrawn()).resolves.toBeUndefined();
        const view = await mount(gallerySpec('taxes-donut'));
        chartOf(view);
        await expect(view.chartDrawn()).resolves.toBeUndefined();
    });
});
