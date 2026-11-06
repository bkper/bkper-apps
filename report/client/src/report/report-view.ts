/**
 * `<report-view>` renders a report spec of the report catalog: the Report with its Answer,
 * Chart, BreakdownTable and Source, in the spec's order, language and direction.
 *
 * Self-contained: no app state and no network. It registers the Web Awesome components it
 * draws with; the page provides the Web Awesome theme and `@bkper/web-design` tokens. Rows
 * open in place (`expandRow`), hovering or opening a row highlights it in the chart, and the
 * link to Bkper (`openInBkper`) fires `report-open-in-bkper` (see `events.ts`); a host that
 * cannot navigate gives a plain `link` instead.
 */
import '@awesome.me/webawesome-pro/dist/components/bar-chart/bar-chart.js';
import '@awesome.me/webawesome-pro/dist/components/doughnut-chart/doughnut-chart.js';
import '@awesome.me/webawesome-pro/dist/components/line-chart/line-chart.js';
import '@awesome.me/webawesome-pro/dist/components/pie-chart/pie-chart.js';
import '@awesome.me/webawesome-pro/dist/components/sparkline/sparkline.js';
import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { renderAnswer } from './answer.js';
import { renderBreakdown } from './breakdown.js';
import { renderChart } from './chart.js';
import { chartConfig, chartSwatches, type ChartView } from './chart-config.js';
import {
    EXPAND_ROW,
    OPEN_IN_BKPER,
    reportEvent,
    type ExpandRowDetail,
    type OpenInBkperDetail,
} from './events.js';
import { ReportFormat } from './format.js';
import { reportViewCSS } from './report-view-css.js';
import { renderSource } from './source.js';
import {
    findRow,
    type BreakdownRow,
    type PropsOf,
    type ReportElement,
    type ReportLink,
    type ReportSpec,
} from './spec-types.js';

type ReportProps = PropsOf<'Report'>;

@customElement('report-view')
export class ReportView extends LitElement {
    static styles = reportViewCSS;

    /** The spec to render, as the app API returns it. */
    @property({ attribute: false }) spec?: ReportSpec;

    /**
     * A plain link the Source shows, such as a report file's link to the Report app, where the
     * host cannot handle the spec's `openInBkper` action.
     */
    @property({ attribute: false }) link?: ReportLink;

    /** Rows open in place, kept across specs so a changed report keeps them open. */
    @state() private expanded: ReadonlySet<string> = new Set();
    @state() private hovered?: string;
    private lastOpened?: string;

    private format?: ReportFormat;
    private chartView?: {
        chart: PropsOf<'Chart'>;
        highlight?: string;
        view: ChartView;
    };

    render() {
        const spec = this.spec;
        const root = spec?.elements[spec.root];
        if (!spec || root?.type !== 'Report') {
            return nothing;
        }
        const props = root.props;
        const format = this.formatFor(props);
        const table = Object.values(spec.elements).find(
            (element): element is Extract<ReportElement, { type: 'BreakdownTable' }> =>
                element.type === 'BreakdownTable'
        );
        const rows = table?.props.rows ?? [];
        const highlight = this.highlight(rows);
        return html`
            <article class="report" lang=${props.locale} dir=${props.dir}>
                <header class="report-header">
                    <h1>${props.title}</h1>
                    <p class="subtitle">${props.subtitle}</p>
                </header>
                ${root.children.map(id => {
                    const element = spec.elements[id];
                    return element
                        ? this.renderElement(element, props, format, rows, highlight)
                        : nothing;
                })}
            </article>
        `;
    }

    private renderElement(
        element: ReportElement,
        report: ReportProps,
        format: ReportFormat,
        rows: BreakdownRow[],
        highlight: BreakdownRow | undefined
    ) {
        switch (element.type) {
            case 'Answer':
                return renderAnswer(element.props, format, report.title);
            case 'Chart':
                return renderChart(
                    this.chartFor(element.props, format, rows, highlight),
                    element.props.label,
                    report.dir
                );
            case 'BreakdownTable':
                return html`<section class="breakdown-section" aria-label=${element.props.label}>
                    ${renderBreakdown(element.props, {
                        format,
                        expanded: this.expanded,
                        expandable: element.on?.expand?.action === 'expandRow',
                        highlighted: highlight?.id,
                        swatches: this.swatches(),
                        onToggle: rowId => this.toggle(rowId),
                        onHover: rowId => (this.hovered = rowId),
                    })}
                </section>`;
            case 'Source': {
                const open = element.on?.open;
                return renderSource(
                    element.props,
                    format,
                    open ? event => this.open(event, { url: open.params.url }) : undefined,
                    this.link
                );
            }
            case 'Report':
            case 'Visualizations':
                return nothing;
        }
    }

    /** The hovered row, else the row opened last while it stays open. */
    private highlight(rows: BreakdownRow[]): BreakdownRow | undefined {
        const id =
            this.hovered ??
            (this.lastOpened && this.expanded.has(this.lastOpened) ? this.lastOpened : undefined);
        return id === undefined ? undefined : findRow(rows, id);
    }

    private toggle(rowId: string): void {
        const expanded = new Set(this.expanded);
        const open = !expanded.has(rowId);
        if (open) {
            expanded.add(rowId);
            this.lastOpened = rowId;
        } else {
            expanded.delete(rowId);
        }
        this.expanded = expanded;
        this.dispatchEvent(reportEvent<ExpandRowDetail>(EXPAND_ROW, { rowId, expanded: open }));
    }

    private open(event: MouseEvent, detail: OpenInBkperDetail): void {
        if (!this.dispatchEvent(reportEvent(OPEN_IN_BKPER, detail, true))) {
            event.preventDefault();
        }
    }

    private formatFor(props: ReportProps): ReportFormat {
        if (
            this.format?.locale !== props.locale ||
            this.format.fractionDigits !== props.fractionDigits
        ) {
            this.format = new ReportFormat(props.locale, props.fractionDigits);
        }
        return this.format;
    }

    /** The chart's configuration, rebuilt only when the chart or its highlight changes. */
    private chartFor(
        chart: PropsOf<'Chart'>,
        format: ReportFormat,
        rows: BreakdownRow[],
        highlight: BreakdownRow | undefined
    ): ChartView {
        const cached = this.chartView;
        if (cached?.chart === chart && cached.highlight === highlight?.id) {
            return cached.view;
        }
        const view = chartConfig(chart, { format, rows, highlight });
        this.chartView = { chart, highlight: highlight?.id, view };
        return view;
    }

    /** The colors of the rows the chart draws, so the table is their legend. */
    private swatches(): ReadonlyMap<string, string> {
        const chart = this.spec && Object.values(this.spec.elements).find(e => e.type === 'Chart');
        return chart?.type === 'Chart' ? chartSwatches(chart.props) : new Map();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'report-view': ReportView;
    }
}
