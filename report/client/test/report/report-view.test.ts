import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    EXPAND_ROW,
    OPEN_IN_BKPER,
    ReportView,
    type ExpandRowDetail,
    type ReportSpec,
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
