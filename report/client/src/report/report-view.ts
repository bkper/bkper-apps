/**
 * `<report-view>` renders a report spec of the report catalog: the Report with its Answer,
 * Chart, Visualizations, BreakdownTable and Source, in the spec's order, language and direction.
 * Several Answers, one per target side by side, show together, in order, where the first is.
 *
 * Self-contained: no app state and no network. It registers the Web Awesome components it
 * draws with; the page provides the Web Awesome theme and `@bkper/web-design` tokens. Rows
 * open in place (`expandRow`), hovering or opening a row highlights it in the chart, and the
 * link to Bkper (`openInBkper`) fires `report-open-in-bkper` (see `events.ts`); a host that
 * cannot navigate gives a plain `link` instead. Above the chart, a preview of every chart that
 * fits (`selectChart`) shows it in place of the chart, from the data the spec carries, and
 * fires `report-select-chart`.
 */
import '@awesome.me/webawesome-pro/dist/components/bar-chart/bar-chart.js';
import '@awesome.me/webawesome-pro/dist/components/doughnut-chart/doughnut-chart.js';
import '@awesome.me/webawesome-pro/dist/components/line-chart/line-chart.js';
import '@awesome.me/webawesome-pro/dist/components/pie-chart/pie-chart.js';
import '@awesome.me/webawesome-pro/dist/components/sparkline/sparkline.js';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { renderAnswer } from './answer.js';
import { renderBreakdown } from './breakdown.js';
import { renderChart } from './chart.js';
import { chartConfig, chartSwatches, type ChartView } from './chart-config.js';
import {
    EXPAND_ROW,
    OPEN_IN_BKPER,
    reportEvent,
    SELECT_CHART,
    type ExpandRowDetail,
    type OpenInBkperDetail,
    type SelectChartDetail,
} from './events.js';
import { ReportFormat } from './format.js';
import { renderPreview } from './preview.js';
import { reportViewCSS } from './report-view-css.js';
import { renderSource } from './source.js';
import {
    findRow,
    type BreakdownRow,
    type PropsOf,
    type ReportElement,
    type ReportLink,
    type ReportSpec,
    type ViewKind,
} from './spec-types.js';

type ReportProps = PropsOf<'Report'>;
type ChartProps = PropsOf<'Chart'>;
type VisualizationsProps = PropsOf<'Visualizations'>;

/** The chart the report shows, by its kind, and what to draw: nothing for the table. */
interface Shown {
    kind: ViewKind;
    chart?: ChartProps;
    /** The charts the person can choose from, when the spec offers them, and its main chart. */
    choices?: VisualizationsProps;
    main?: ChartProps;
}

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

    /**
     * The chart shown, one of the charts the spec offers (`Visualizations`); by default, and
     * for a kind it does not offer, its main one. Choosing a preview sets it; a new spec
     * starts at its main chart unless its host sets this with it.
     */
    @property({ attribute: false }) chart?: ViewKind;

    /** Rows open in place, kept across specs so a changed report keeps them open. */
    @state() private expanded: ReadonlySet<string> = new Set();
    @state() private hovered?: string;
    private lastOpened?: string;

    private format?: ReportFormat;
    private chartView?: {
        chart: ChartProps;
        highlight?: string;
        view: ChartView;
    };
    /** The drawings of the previews of the spec, which change only with it. */
    private previews?: { spec: ReportSpec; drawings: Map<ViewKind, TemplateResult> };

    protected willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('spec') && !changed.has('chart')) {
            this.chart = undefined;
        }
    }

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
        const shown = this.shown(spec);
        // Several Answers, of targets side by side, show together where the first one is.
        const answers = root.children.flatMap(id => {
            const element = spec.elements[id];
            return element?.type === 'Answer' ? [element.props] : [];
        });
        const firstAnswer = root.children.find(id => spec.elements[id]?.type === 'Answer');
        return html`
            <article class="report" lang=${props.locale} dir=${props.dir}>
                <header class="report-header">
                    <h1>${props.title}</h1>
                    <p class="subtitle">${props.subtitle}</p>
                </header>
                ${root.children.map(id => {
                    const element = spec.elements[id];
                    if (element?.type === 'Answer' && answers.length > 1) {
                        return id === firstAnswer
                            ? html`<div class="answers">
                                  ${answers.map(answer => renderAnswer(answer, format, props.title))}
                              </div>`
                            : nothing;
                    }
                    return element
                        ? this.renderElement(element, props, format, rows, highlight, shown)
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
        highlight: BreakdownRow | undefined,
        shown: Shown
    ) {
        switch (element.type) {
            case 'Answer':
                return renderAnswer(element.props, format, report.title);
            case 'Chart':
                // With a choice of charts, the one shown goes just after its previews.
                return shown.choices
                    ? nothing
                    : this.renderShown(shown, report, format, rows, highlight);
            case 'Visualizations':
                return shown.choices
                    ? html`${this.renderPreviews(shown, shown.choices, report.dir)}
                      ${this.renderShown(shown, report, format, rows, highlight)}`
                    : nothing;
            case 'BreakdownTable':
                return html`<section class="breakdown-section" aria-label=${element.props.label}>
                    ${renderBreakdown(element.props, {
                        format,
                        expanded: this.expanded,
                        expandable: element.on?.expand?.action === 'expandRow',
                        highlighted: highlight?.id,
                        // The colors of the rows the chart draws: the table is their legend.
                        swatches: shown.chart ? chartSwatches(shown.chart) : new Map(),
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
                return nothing;
        }
    }

    private renderShown(
        shown: Shown,
        report: ReportProps,
        format: ReportFormat,
        rows: BreakdownRow[],
        highlight: BreakdownRow | undefined
    ) {
        return shown.chart
            ? renderChart(
                  this.chartFor(shown.chart, format, rows, highlight),
                  shown.kind,
                  shown.chart.label,
                  report.dir
              )
            : nothing;
    }

    /**
     * A toolbar of previews, in the spec's order: the chart asked for that does not fit first,
     * dimmed with why, then every chart that fits, the one shown pressed. The table stays below
     * the chart, not among the previews. Only the one shown is in the tab order, or the first
     * chart for a table-only report; arrows move between them, a click, Enter or Space shows one.
     */
    private renderPreviews(shown: Shown, choices: VisualizationsProps, dir: 'ltr' | 'rtl') {
        const views = choices.views.filter(view => view.kind !== 'table');
        const unfit = choices.unfit?.kind === 'table' ? undefined : choices.unfit;
        if (views.length === 0 && !unfit) return nothing;
        const tabKind = views.find(view => view.kind === shown.kind)?.kind ?? views[0]?.kind;
        const drawings = this.drawings(choices, shown.main);
        return html`<div
            class="previews"
            role="toolbar"
            aria-label=${choices.label}
            @keydown=${(event: KeyboardEvent) => this.movePreviewFocus(event, dir)}
        >
            ${
                unfit
                    ? html`<button
                          type="button"
                          class="preview unfit"
                          aria-disabled="true"
                          tabindex="-1"
                      >
                          <span class="thumb">${renderPreview(unfit.kind)}</span>
                          <span class="preview-name">${unfit.name}</span>
                          <span class="preview-reason">${unfit.reason}</span>
                      </button>`
                    : nothing
            }
            ${views.map(
                view =>
                    html`<button
                        type="button"
                        class="preview"
                        data-kind=${view.kind}
                        aria-pressed=${view.kind === shown.kind ? 'true' : 'false'}
                        tabindex=${view.kind === tabKind ? 0 : -1}
                        @click=${() => this.select(view.kind, shown.kind)}
                    >
                        <span class="thumb">${drawings.get(view.kind)}</span>
                        <span class="preview-name">${view.name}</span>
                    </button>`
            )}
        </div>`;
    }

    /** Arrow keys move to the next or previous preview in the report's direction; Home and End to the ends. */
    private movePreviewFocus(event: KeyboardEvent, dir: 'ltr' | 'rtl'): void {
        const buttons = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.preview')];
        const index = buttons.findIndex(button => button === event.target);
        if (index < 0) return;
        const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
        const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
        const next =
            event.key === forward
                ? Math.min(index + 1, buttons.length - 1)
                : event.key === backward
                  ? Math.max(index - 1, 0)
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : undefined;
        if (next === undefined) return;
        event.preventDefault();
        buttons[next].focus();
    }

    /** Show another chart, at once: its data is in the spec. */
    private select(kind: ViewKind, shown: ViewKind): void {
        if (kind === shown) return;
        this.chart = kind;
        this.dispatchEvent(reportEvent<SelectChartDetail>(SELECT_CHART, { kind }));
    }

    /**
     * The chart to show: the one chosen, when the spec offers it, else the main one; the spec's
     * Chart for the main one, the data of its view for another, none for the table.
     */
    private shown(spec: ReportSpec): Shown {
        const elements = Object.values(spec.elements);
        const main = elements.find(
            (element): element is Extract<ReportElement, { type: 'Chart' }> =>
                element.type === 'Chart'
        )?.props;
        const visualizations = elements.find(
            (element): element is Extract<ReportElement, { type: 'Visualizations' }> =>
                element.type === 'Visualizations'
        );
        if (visualizations?.on?.select?.action !== 'selectChart') {
            return { kind: main?.kind ?? 'table', chart: main };
        }
        const choices = visualizations.props;
        const chosen = choices.views.find(view => view.kind === this.chart);
        if (!chosen || chosen.kind === choices.main) {
            return { kind: choices.main, chart: main, choices, main };
        }
        return { kind: chosen.kind, chart: chosen.chart, choices, main };
    }

    /** The drawing of each preview: the main one from the Chart, the others from their views. */
    private drawings(
        choices: VisualizationsProps,
        main: ChartProps | undefined
    ): Map<ViewKind, TemplateResult> {
        const spec = this.spec;
        if (spec && this.previews?.spec === spec) {
            return this.previews.drawings;
        }
        const drawings = new Map(
            choices.views
                .filter(view => view.kind !== 'table')
                .map(view => [
                    view.kind,
                    renderPreview(view.kind, view.kind === choices.main ? main : view.chart),
                ])
        );
        if (spec) {
            this.previews = { spec, drawings };
        }
        return drawings;
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
        chart: ChartProps,
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
}

declare global {
    interface HTMLElementTagNameMap {
        'report-view': ReportView;
    }
}
