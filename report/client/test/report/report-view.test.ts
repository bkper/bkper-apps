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
    it('renders every recorded spec, answer first, then chart, table and source', async () => {
        for (const id of galleryIds()) {
            const spec = gallerySpec(id);
            const view = await mount(spec);
            const order = [...root(view).querySelectorAll('.report > *')].map(
                node => node.className
            );
            const expected = ['report-header', 'answer'];
            if (Object.values(spec.elements).some(element => element.type === 'Chart')) {
                expected.push(expect.stringContaining('chart'));
            }
            if (Object.values(spec.elements).some(element => element.type === 'Visualizations')) {
                expected.push('previews');
            }
            expect(order, id).toEqual([...expected, 'breakdown-section', 'source']);
        }
    });

    it('draws every chart kind with its Web Awesome chart, and no chart for a table', async () => {
        const drawn: Record<string, string> = {
            'revenue-pie': 'wa-pie-chart',
            'revenue-donut-ja': 'wa-doughnut-chart',
            'expenses-stacked': 'wa-bar-chart',
            'bank-accounts-area': 'wa-line-chart',
            'expenses-compare': 'wa-bar-chart[orientation="horizontal"]',
            'net-result-waterfall': 'wa-bar-chart[orientation="horizontal"]',
        };
        for (const [id, selector] of Object.entries(drawn)) {
            const view = await mount(gallerySpec(id));
            expect(root(view).querySelector(`.chart > ${selector}`), id).not.toBeNull();
        }
        const table = await mount(gallerySpec('expenses-table'));
        expect(root(table).querySelector('.chart')).toBeNull();
        expect(root(table).querySelector('.breakdown-section')).not.toBeNull();
    });

    it('shows the swatches of a pie and of a stacked chart in the table', async () => {
        for (const id of ['revenue-pie', 'expenses-stacked']) {
            const view = await mount(gallerySpec(id));
            expect(root(view).querySelectorAll('tbody .swatch').length, id).toBeGreaterThan(1);
        }
    });

    it('formats amounts and ratios in the report locale', async () => {
        const spec = gallerySpec('net-result-by-month-pt');
        const view = await mount(spec);
        const answer = elementOf(spec, 'Answer').props;
        expect(text(view, '.answer-amount')).toEqual(['50.371,36']);
        expect(text(view, '.answer-comparison .change')).toEqual(['+148,1%']);
        expect(text(view, '.part-amount')).toEqual(
            (answer.parts ?? []).map(part => new ReportFormat('pt-BR', 2).amount(part.amount))
        );
        expect(text(view, 'tbody td.amount')).toEqual(['400.724,18', '350.352,82']);
    });

    it('totals the Incoming and Outgoing rows of a net result with the net result', async () => {
        const spec = gallerySpec('net-result-by-month-pt');
        const view = await mount(spec);
        const answer = elementOf(spec, 'Answer').props;
        const format = new ReportFormat('pt-BR', 2);
        expect(text(view, 'tfoot th')).toEqual([elementOf(spec, 'Report').props.title]);
        expect(text(view, 'tfoot td.amount')).toEqual([format.amount(answer.amount)]);
        expect(text(view, 'tfoot td.change')).toEqual([format.change(answer.change ?? '')]);
        // Outgoing changes the same way in the answer and in the table.
        const outgoing = answer.parts?.find(part => part.id === 'outgoing');
        expect(text(view, '.answer-part:last-child .change')).toEqual(
            text(view, 'tr[data-row="outgoing"] td.change')
        );
        expect(outgoing?.change).toBe(
            elementOf(spec, 'BreakdownTable').props.rows.find(row => row.id === 'outgoing')?.change
        );
        expect(root(view).querySelectorAll('tfoot wa-sparkline')).toHaveLength(1);
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
        const click = new Event('click', { bubbles: true, cancelable: true });
        link?.dispatchEvent(click);
        document.body.removeEventListener(OPEN_IN_BKPER, handle);
        expect(opened).toEqual([elementOf(spec, 'Source').props.url]);
        expect(click.defaultPrevented).toBe(true);
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
        expect(previews(view).map(button => button.dataset.kind)).toEqual(
            visualizations.views.map(entry => entry.kind)
        );
        expect(text(view, '.preview .preview-name')).toEqual(
            visualizations.views.map(entry => entry.name)
        );
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

        preview(view, 'pie').click();
        await view.updateComplete;

        expect(shownKind(view)).toBe('pie');
        expect(root(view).querySelector('.chart > wa-pie-chart')).not.toBeNull();
        expect(preview(view, 'pie').getAttribute('aria-pressed')).toBe('true');
        expect(preview(view, 'bar').getAttribute('aria-pressed')).toBe('false');
        expect(view.chart).toBe('pie');
        expect(chosen).toEqual([{ kind: 'pie' }]);
        // The table's swatches follow the chart shown.
        expect(root(view).querySelectorAll('tbody .swatch').length).toBeGreaterThan(1);

        preview(view, 'table').click();
        await view.updateComplete;
        expect(root(view).querySelector('.chart')).toBeNull();
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
        const order = [...root(view).querySelectorAll('.report > *')].map(node => node.className);
        expect(order.indexOf('previews')).toBe(order.findIndex(name => name.includes('chart')) + 1);
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
        view.chart = 'waterfall';
        await view.updateComplete;
        expect(shownKind(view)).toBe('ranked-bar');
    });

    it('dims the chart asked for that does not fit, with why, and never shows it', async () => {
        const spec = gallerySpec('mixed-pie-fallback');
        const view = await mount(spec);
        const unfit = root(view).querySelector<HTMLButtonElement>('.preview.unfit');
        expect(unfit?.getAttribute('aria-disabled')).toBe('true');
        expect(unfit?.getAttribute('aria-pressed')).toBeNull();
        // Its reason is visible, and part of what is read out.
        const reason = elementOf(spec, 'Visualizations').props.unfit?.reason;
        expect(reason).toContain('Rent');
        expect(unfit?.querySelector('.preview-reason')?.textContent?.trim()).toBe(reason);
        expect(unfit?.textContent).toContain('Pie');
        const chosen: SelectChartDetail[] = [];
        document.body.addEventListener(SELECT_CHART, event => chosen.push(event.detail));
        unfit?.click();
        await view.updateComplete;
        expect(shownKind(view)).toBe('ranked-bar');
        expect(chosen).toEqual([]);
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
