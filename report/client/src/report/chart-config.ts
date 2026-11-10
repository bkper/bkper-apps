/**
 * The Chart.js configuration of a report chart, for Web Awesome's chart elements: by month
 * (bars for activity, a line for positions, areas, or parts stacked), the top rows of the
 * breakdown (ranked horizontal bars or a donut), each row now and before (paired
 * horizontal bars), or a bridge (floating horizontal bars). Values are drawn from the spec's
 * decimals; tooltips show the exact amounts. A highlighted breakdown row stands out, and the
 * rest fades.
 */
import type { ChartConfiguration, ChartDataset, Plugin } from 'chart.js';
import { isolate } from 'report-shared/bidi';
import { faded, hollow, seriesTones, shades, typeColor } from './colors.js';
import { ReportFormat } from './format.js';
import { findRow, topRow, type BreakdownRow, type PropsOf, type TypeColor } from './spec-types.js';

type ChartProps = PropsOf<'Chart'>;
type ChartKind<K extends ChartProps['kind']> = Extract<ChartProps, { kind: K }>;
type ChartElement = 'bar' | 'line' | 'doughnut';
/** A value, a floating bar's start and end, or nothing to draw. */
type Datum = number | [number, number] | null;
type Dataset = ChartDataset<ChartElement, Datum[]>;
type Config = ChartConfiguration<ChartElement, Datum[], string>;

export interface ChartView {
    /** The Web Awesome chart to draw with: `wa-bar-chart`, `wa-line-chart` or `wa-doughnut-chart`. */
    element: ChartElement;
    /** Bars along the inline axis, a row each: ranked parts, comparisons and bridges. */
    horizontal: boolean;
    legend: boolean;
    config: Config;
    /** The text drawn at the end of each bar, such as a bridge's steps with their sign. */
    barLabels?: string[];
    /** The tooltip line of a value: its name and exact amount. */
    tooltipLabel(datasetIndex: number, dataIndex: number): string;
    /** A value-axis tick. */
    axisLabel(value: number): string;
}

export interface ChartContext {
    format: ReportFormat;
    /** The breakdown rows the chart draws from. */
    rows: BreakdownRow[];
    /** The breakdown row to highlight, at any depth. */
    highlight?: BreakdownRow;
}

interface Series {
    label: string;
    /** The series' color, before any emphasis. */
    color: string;
    /** The series' color when it stands out. */
    strong: string;
    /** A line over the bars of a bar chart, or over the areas of an area chart. */
    line: boolean;
    values: string[];
    emphasis: 'normal' | 'strong' | 'faded';
}

/** The shortest bar drawn, in pixels, so no ranked value vanishes. */
const MIN_BAR_LENGTH = 3;

/** Space past the largest values of a ranked chart, as Web Awesome leaves on value axes. */
const VALUE_GRACE = '5%';

/** Space past the ends of a bridge, for the value labels drawn there. */
const LABELLED_GRACE = '18%';

/** Width of the outline that marks a previous period, or a step down, in pixels. */
const OUTLINE_WIDTH = 2;

/** Gap between a bar and its label, in pixels. */
const LABEL_GAP = 4;

/** A name and its value, each isolated so they read in order in either direction. */
function valueLabel(name: string, value: string): string {
    return `${isolate(name)}: ${isolate(value)}`;
}

/** The configuration of a chart. */
export function chartConfig(chart: ChartProps, context: ChartContext): ChartView {
    switch (chart.kind) {
        case 'bar':
        case 'line':
        case 'area':
        case 'stacked':
            return byMonth(chart, context);
        case 'ranked-bar':
        case 'donut':
            return breakdown(chart, context);
        case 'compare':
            return compare(chart, context);
        case 'waterfall':
            return waterfall(chart, context);
    }
}

/**
 * The color of each breakdown row a chart draws as an item or a series of its own, so the
 * breakdown table is the legend of its colors.
 */
export function chartSwatches(chart: ChartProps): ReadonlyMap<string, string> {
    switch (chart.kind) {
        case 'ranked-bar':
            return new Map(chart.items.map(item => [item.rowId, typeColor(item.color, 'medium')]));
        case 'compare':
            return new Map(chart.items.map(item => [item.rowId, typeColor(item.color, 'high')]));
        case 'donut': {
            const colors = shades(chart.items.map(item => item.color));
            return new Map(chart.items.map((item, index) => [item.rowId, colors[index]]));
        }
        case 'stacked': {
            const colors = shades(chart.series.map(series => series.color));
            return new Map(chart.series.map((series, index) => [series.id, colors[index]]));
        }
        default:
            return new Map();
    }
}

function byMonth(chart: ChartKind<'bar' | 'line' | 'area' | 'stacked'>, context: ChartContext) {
    const { format, rows, highlight } = context;
    const stacked = chart.kind === 'stacked';
    const area = chart.kind === 'area';
    const element = chart.kind === 'bar' || stacked ? 'bar' : 'line';
    // Charts leave out rows without an amount in the period, even when highlighted.
    const drawn = highlight && ReportFormat.plot(highlight.amount) !== 0 ? highlight : undefined;
    // Stacked parts add up to the whole: a highlight picks the part it is in, and adds none.
    const standsFor = (id: string) =>
        drawn !== undefined && (id === drawn.id || (stacked && id === topRow(rows, drawn.id)?.id));
    const stood = chart.series.find(series => standsFor(series.id));
    const stackShades = stacked ? shades(chart.series.map(series => series.color)) : [];
    const isLine = (entry: (typeof chart.series)[number]) => 'line' in entry && entry.line === true;
    // Series of one type color, such as targets side by side, each in a tone of its own.
    const drawnAs = (lines: boolean) => {
        const entries = chart.series.filter(entry => isLine(entry) === lines);
        const tones = seriesTones(
            entries.map(entry => entry.color),
            element === 'line' || lines ? 'high' : 'medium'
        );
        return new Map(entries.map((entry, index) => [entry, tones[index]]));
    };
    const tones = new Map([...drawnAs(false), ...drawnAs(true)]);
    const series: Series[] = chart.series.map((entry, index) => {
        const line = isLine(entry);
        const color = stacked ? stackShades[index] : (tones.get(entry) ?? '');
        return {
            label: entry.label,
            color,
            strong: stacked ? color : typeColor(entry.color, 'high'),
            line,
            values: entry.values,
            emphasis: !drawn ? 'normal' : entry === stood ? 'strong' : 'faded',
        };
    });
    if (drawn && !stood && !stacked && drawn.months.length === chart.months.length) {
        series.push({
            label: drawn.label,
            color: typeColor(drawn.color, 'high'),
            strong: typeColor(drawn.color, 'high'),
            line: false,
            values: drawn.months,
            emphasis: 'strong',
        });
    }
    const spansYears =
        chart.months[0].slice(0, 4) !== chart.months[chart.months.length - 1].slice(0, 4);
    const datasets = series.map(entry => monthDataset(element, area, stacked, entry));
    const tooltipLabel = (datasetIndex: number, dataIndex: number) =>
        valueLabel(
            series[datasetIndex].label,
            format.amount(series[datasetIndex].values[dataIndex])
        );
    const axisLabel = (value: number) => format.compact(value);
    const config: Config = {
        type: element,
        data: {
            labels: chart.months.map(month => format.month(month, spansYears ? 'year' : 'short')),
            datasets,
        },
        options: {
            plugins: {
                title: { display: false },
                legend: {
                    display: series.length > 1,
                    position: 'bottom',
                    // In series order, whatever order the datasets are drawn in.
                    labels: { sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0) },
                },
                tooltip: {
                    callbacks: {
                        title: items =>
                            items[0] ? format.month(chart.months[items[0].dataIndex], 'long') : '',
                        label: item => tooltipLabel(item.datasetIndex, item.dataIndex),
                    },
                },
            },
            scales: {
                // Parts stack into the whole. Lines and areas keep half a month from the edges,
                // so the labels of the first and last months show whole in either direction.
                ...(stacked
                    ? { x: { stacked: true } }
                    : element === 'line'
                      ? { x: { offset: true } }
                      : {}),
                // Areas stand on zero, as amounts do.
                y: {
                    ...(stacked ? { stacked: true } : {}),
                    ...(area ? { beginAtZero: true } : {}),
                    ticks: { callback: value => axisLabel(Number(value)) },
                },
            },
        },
    };
    return {
        element,
        horizontal: false,
        legend: series.length > 1,
        config,
        tooltipLabel,
        axisLabel,
    } satisfies ChartView;
}

function monthDataset(
    chart: 'bar' | 'line',
    area: boolean,
    stacked: boolean,
    series: Series
): Dataset {
    const element = series.line ? 'line' : chart;
    const color =
        series.emphasis === 'strong'
            ? series.strong
            : series.emphasis === 'faded'
              ? faded(series.color)
              : series.color;
    const data = series.values.map(ReportFormat.plot);
    if (element === 'line') {
        const filled = area && !series.line;
        return {
            type: 'line',
            label: series.label,
            data,
            borderColor: color,
            backgroundColor: filled ? hollow(color) : color,
            pointBackgroundColor: color,
            ...(area ? { fill: filled ? 'origin' : false } : {}),
            // Chart.js draws lower orders on top: a line over bars or areas stays visible.
            ...(chart === 'bar' || (area && series.line) ? { order: -1 } : {}),
        };
    }
    return {
        type: 'bar',
        label: series.label,
        data,
        backgroundColor: color,
        // A line of the page's surface between stacked parts, so neighbouring shades stay apart.
        ...(stacked
            ? { borderColor: 'var(--wa-color-surface-default)', borderWidth: 1 }
            : { borderColor: color, borderWidth: 0 }),
        maxBarThickness: 40,
    };
}

/** The top-level row a highlight is about, when the chart draws it as an item. */
function highlightedItem(items: { rowId: string }[], context: ChartContext): string | undefined {
    const { rows, highlight } = context;
    // Rows the chart does not draw, such as rows without an amount, highlight nothing in it.
    const top = highlight && topRow(rows, highlight.id)?.id;
    return items.some(item => item.rowId === top) ? top : undefined;
}

function breakdown(chart: ChartKind<'ranked-bar' | 'donut'>, context: ChartContext) {
    const { format } = context;
    const round = chart.kind === 'donut';
    const element: ChartElement = round ? 'doughnut' : 'bar';
    const highlighted = highlightedItem(chart.items, context);
    const base = [...chartSwatches(chart).values()];
    const colors = chart.items.map((item, index) => {
        if (!highlighted) {
            return base[index];
        }
        if (item.rowId !== highlighted) {
            return faded(base[index]);
        }
        return round ? base[index] : typeColor(item.color, 'high');
    });
    const tooltipLabel = (_datasetIndex: number, dataIndex: number) =>
        valueLabel(chart.items[dataIndex].label, format.amount(chart.items[dataIndex].value));
    const axisLabel = (value: number) => format.compact(value);
    const data = chart.items.map(item => ReportFormat.plot(item.value));
    const tooltip = {
        callbacks: {
            title: () => '',
            label: (item: { dataIndex: number }) => tooltipLabel(0, item.dataIndex),
        },
    };
    const config: Config = round
        ? {
              type: element,
              data: {
                  labels: chart.items.map(item => item.label),
                  datasets: [
                      {
                          type: 'doughnut',
                          label: chart.label,
                          data,
                          backgroundColor: colors,
                          borderColor: 'var(--wa-color-surface-default)',
                          borderWidth: 2,
                          hoverOffset: 6,
                      },
                  ],
              },
              options: {
                  cutout: '62%',
                  plugins: { title: { display: false }, legend: { display: false }, tooltip },
              },
          }
        : {
              type: 'bar',
              data: {
                  labels: chart.items.map(item => item.label),
                  datasets: [
                      {
                          type: 'bar',
                          label: chart.label,
                          data,
                          backgroundColor: colors,
                          borderColor: colors,
                          borderWidth: 0,
                          maxBarThickness: 28,
                          // A value tiny next to the others, such as a small overdraft, still shows.
                          minBarLength: MIN_BAR_LENGTH,
                      },
                  ],
              },
              options: {
                  plugins: { title: { display: false }, legend: { display: false }, tooltip },
                  scales: {
                      x: {
                          // Room on both sides of the values, so bars of negative values, which
                          // go the other way from zero, show past it.
                          grace: VALUE_GRACE,
                          ticks: { callback: value => axisLabel(Number(value)) },
                      },
                  },
              },
          };
    return { element, horizontal: !round, legend: false, config, tooltipLabel, axisLabel };
}

/**
 * Each row in the previous period and in this one, side by side in time order: the previous
 * period outlined, this one solid, so they differ in more than color; the legend names both.
 */
function compare(chart: ChartKind<'compare'>, context: ChartContext): ChartView {
    const { format } = context;
    const highlighted = highlightedItem(chart.items, context);
    const emphasis = (color: string, rowId: string) =>
        highlighted && rowId !== highlighted ? faded(color) : color;
    const fills = (fill: (color: TypeColor) => string) =>
        chart.items.map(item => emphasis(fill(item.color), item.rowId));
    // Nothing in a period draws no bar, not even the shortest one.
    const plot = (value: string): Datum =>
        ReportFormat.plot(value) === 0 ? null : ReportFormat.plot(value);
    const periods = [
        { label: chart.periods.previous, values: chart.items.map(item => item.previous) },
        { label: chart.periods.current, values: chart.items.map(item => item.value) },
    ];
    const bar = { type: 'bar', maxBarThickness: 20, minBarLength: MIN_BAR_LENGTH } as const;
    const datasets: Dataset[] = [
        {
            ...bar,
            label: periods[0].label,
            data: periods[0].values.map(plot),
            backgroundColor: fills(color => hollow(typeColor(color, 'high'))),
            borderColor: fills(color => typeColor(color, 'high')),
            borderWidth: OUTLINE_WIDTH,
            borderSkipped: false,
        },
        {
            ...bar,
            label: periods[1].label,
            data: periods[1].values.map(plot),
            backgroundColor: fills(color => typeColor(color, 'high')),
            borderColor: fills(color => typeColor(color, 'high')),
            borderWidth: 0,
        },
    ];
    const tooltipLabel = (datasetIndex: number, dataIndex: number) =>
        valueLabel(
            periods[datasetIndex].label,
            format.amount(periods[datasetIndex].values[dataIndex])
        );
    const axisLabel = (value: number) => format.compact(value);
    const config: Config = {
        type: 'bar',
        data: { labels: chart.items.map(item => item.label), datasets },
        options: {
            plugins: {
                title: { display: false },
                legend: { display: true, position: 'bottom' },
                tooltip: {
                    callbacks: {
                        title: items => (items[0] ? chart.items[items[0].dataIndex].label : ''),
                        label: item => tooltipLabel(item.datasetIndex, item.dataIndex),
                    },
                },
            },
            scales: {
                x: { grace: VALUE_GRACE, ticks: { callback: value => axisLabel(Number(value)) } },
            },
        },
    };
    return { element: 'bar', horizontal: true, legend: true, config, tooltipLabel, axisLabel };
}

interface BridgeBar {
    label: string;
    color: TypeColor;
    value: string;
    /** The first or last bar, standing on zero; else a step floating from the bar before. */
    total: boolean;
    rowId?: string;
}

/**
 * A bridge as floating bars, one row each: the start and the end stand on zero, solid; each
 * step floats from where the bar before it ended. A step up is solid and a step down outlined,
 * and every bar is labelled with its value, steps with their sign, so the direction never
 * rests on color alone.
 */
function waterfall(chart: ChartKind<'waterfall'>, context: ChartContext): ChartView {
    const { format } = context;
    const bars: BridgeBar[] = [
        { ...chart.start, total: true },
        ...chart.steps.map(step => ({ ...step, total: false })),
        { ...chart.end, total: true },
    ];
    let level = 0;
    const data = bars.map((bar): [number, number] => {
        const value = ReportFormat.plot(bar.value);
        const from = bar.total ? 0 : level;
        level = from + value;
        return [from, level];
    });
    // The rest of the steps is part of a highlighted row that holds steps, such as Outgoing.
    const holdsSteps = bars.some(
        bar =>
            bar.rowId !== undefined &&
            context.highlight !== undefined &&
            bar.rowId !== context.highlight.id &&
            findRow([context.highlight], bar.rowId) !== undefined
    );
    const highlighted = bars.map(bar =>
        bar.total ? false : bar.rowId === undefined ? holdsSteps : isHighlightedStep(bar, context)
    );
    const anyHighlighted = highlighted.some(Boolean);
    const emphasis = (color: string, index: number) =>
        anyHighlighted && !highlighted[index] ? faded(color) : color;
    const down = (bar: BridgeBar) => !bar.total && ReportFormat.plot(bar.value) < 0;
    const fill = (bar: BridgeBar) =>
        bar.total
            ? typeColor(bar.color, 'high')
            : down(bar)
              ? hollow(typeColor(bar.color, 'medium'))
              : typeColor(bar.color, 'medium');
    const tooltipLabel = (_datasetIndex: number, dataIndex: number) => {
        const bar = bars[dataIndex];
        return valueLabel(
            bar.label,
            bar.total ? format.amount(bar.value) : format.signedAmount(bar.value)
        );
    };
    const axisLabel = (value: number) => format.compact(value);
    const barLabels = bars.map(bar =>
        bar.total
            ? format.compact(ReportFormat.plot(bar.value))
            : format.signedCompact(ReportFormat.plot(bar.value))
    );
    const config: Config = {
        type: 'bar',
        data: {
            labels: bars.map(bar => bar.label),
            datasets: [
                {
                    type: 'bar',
                    label: chart.label,
                    data,
                    backgroundColor: bars.map((bar, index) => emphasis(fill(bar), index)),
                    borderColor: bars.map((bar, index) =>
                        emphasis(typeColor(bar.color, 'high'), index)
                    ),
                    borderWidth: bars.map(bar => (down(bar) ? OUTLINE_WIDTH : 0)),
                    borderSkipped: false,
                    maxBarThickness: 28,
                    minBarLength: MIN_BAR_LENGTH,
                },
            ],
        },
        options: {
            plugins: {
                title: { display: false },
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: () => '',
                        label: item => tooltipLabel(0, item.dataIndex),
                    },
                },
            },
            scales: {
                x: {
                    grace: LABELLED_GRACE,
                    ticks: { callback: value => axisLabel(Number(value)) },
                },
            },
        },
        plugins: [barLabelsPlugin(barLabels)],
    };
    return {
        element: 'bar',
        horizontal: true,
        legend: false,
        config,
        barLabels,
        tooltipLabel,
        axisLabel,
    };
}

/** Whether a bridge's bar is a step of the highlighted row, or of a row in it, or holds it. */
function isHighlightedStep(bar: BridgeBar, { rows, highlight }: ChartContext): boolean {
    if (!highlight || bar.rowId === undefined) {
        return false;
    }
    const row = findRow(rows, bar.rowId);
    return (
        findRow([highlight], bar.rowId) !== undefined ||
        (row !== undefined && findRow([row], highlight.id) !== undefined)
    );
}

/**
 * Draws a label past one end of each bar of the first dataset, in the axis ticks' font and
 * color, so it follows the theme: past the end Chart.js draws the bar to, else, where the label
 * does not fit in the chart, past its other end. Ends are measured in pixels, so it works in
 * either direction.
 */
function barLabelsPlugin(labels: string[]): Plugin<ChartElement> {
    return {
        id: 'reportBarLabels',
        afterDatasetsDraw(chart) {
            const ticks = chart.options.scales?.x?.ticks;
            const font = typeof ticks?.font === 'object' ? ticks.font : {};
            const size = typeof font.size === 'number' ? font.size : 12;
            const family = typeof font.family === 'string' ? font.family : 'sans-serif';
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.font = `${size}px ${family}`;
            ctx.fillStyle = typeof ticks?.color === 'string' ? ticks.color : 'currentColor';
            ctx.textBaseline = 'middle';
            chart.getDatasetMeta(0).data.forEach((bar, index) => {
                const label = labels[index] ?? '';
                const { x, y, base } = bar.getProps(['x', 'y', 'base'], true);
                const end = Number(x);
                const start = Number(base);
                const width = ctx.measureText(label).width + LABEL_GAP;
                const forward = end >= start;
                const fits = forward
                    ? end + width <= chartArea.right
                    : end - width >= chartArea.left;
                const from = fits ? end : start;
                const right = fits === forward;
                ctx.textAlign = right ? 'left' : 'right';
                ctx.fillText(label, from + (right ? LABEL_GAP : -LABEL_GAP), Number(y));
            });
            ctx.restore();
        },
    };
}
