/**
 * The Chart.js configuration of a report chart, for Web Awesome's chart elements: by month
 * (bars for activity, a line for positions), or the top rows of the breakdown (ranked
 * horizontal bars, or a donut). Values are drawn from the spec's decimals; tooltips show the
 * exact amounts. A highlighted breakdown row stands out, and the rest fades.
 */
import type { ChartConfiguration, ChartDataset } from 'chart.js';
import { isolate } from 'report-shared/bidi';
import { faded, shades, typeColor } from './colors.js';
import { ReportFormat } from './format.js';
import { topRow, type BreakdownRow, type PropsOf, type TypeColor } from './spec-types.js';

type ChartProps = PropsOf<'Chart'>;
type ChartElement = 'bar' | 'line' | 'doughnut';
type Dataset = ChartDataset<ChartElement, number[]>;

export interface ChartView {
    /** The Web Awesome chart to draw with: `wa-bar-chart`, `wa-line-chart` or `wa-doughnut-chart`. */
    element: ChartElement;
    /** Bars along the inline axis, for ranked parts. */
    horizontal: boolean;
    legend: boolean;
    config: ChartConfiguration<ChartElement, number[], string>;
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
    color: TypeColor;
    /** A line over the bars of a bar chart. */
    line: boolean;
    values: string[];
    emphasis: 'normal' | 'strong' | 'faded';
}

/** The shortest bar drawn, in pixels, so no ranked value vanishes. */
const MIN_BAR_LENGTH = 3;

/** Space past the largest values of a ranked chart, as Web Awesome leaves on value axes. */
const VALUE_GRACE = '5%';

/** A name and its value, each isolated so they read in order in either direction. */
function valueLabel(name: string, value: string): string {
    return `${isolate(name)}: ${isolate(value)}`;
}

/**
 * The configuration of a chart, or `undefined` for a kind this renderer does not draw yet:
 * areas draw as lines, stacked parts as bars side by side, a pie as a donut.
 */
export function chartConfig(chart: ChartProps, context: ChartContext): ChartView | undefined {
    switch (chart.kind) {
        case 'bar':
        case 'stacked':
            return byMonth(chart, 'bar', context);
        case 'line':
        case 'area':
            return byMonth(chart, 'line', context);
        case 'ranked-bar':
        case 'donut':
        case 'pie':
            return breakdown(chart, context);
        case 'compare':
        case 'waterfall':
            return undefined;
    }
}

function byMonth(
    chart: Extract<ChartProps, { months: string[] }>,
    element: 'bar' | 'line',
    context: ChartContext
) {
    const { format, highlight } = context;
    const stood = highlight && chart.series.find(series => series.id === highlight.id);
    // Charts leave out rows without an amount in the period, even when highlighted.
    const drawn = highlight && ReportFormat.plot(highlight.amount) !== 0 ? highlight : undefined;
    const series: Series[] = chart.series.map(entry => ({
        label: entry.label,
        color: entry.color,
        line: 'line' in entry && entry.line === true,
        values: entry.values,
        emphasis: !drawn ? 'normal' : entry === stood ? 'strong' : 'faded',
    }));
    if (drawn && !stood && drawn.months.length === chart.months.length) {
        series.push({
            label: drawn.label,
            color: drawn.color,
            line: false,
            values: drawn.months,
            emphasis: 'strong',
        });
    }
    const spansYears =
        chart.months[0].slice(0, 4) !== chart.months[chart.months.length - 1].slice(0, 4);
    const datasets = series.map(entry => monthDataset(element, entry));
    const tooltipLabel = (datasetIndex: number, dataIndex: number) =>
        valueLabel(
            series[datasetIndex].label,
            format.amount(series[datasetIndex].values[dataIndex])
        );
    const axisLabel = (value: number) => format.compact(value);
    const config: ChartConfiguration<ChartElement, number[], string> = {
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
            scales: { y: { ticks: { callback: value => axisLabel(Number(value)) } } },
        },
    };
    return {
        element,
        horizontal: false,
        legend: series.length > 1,
        config,
        tooltipLabel,
        axisLabel,
    };
}

function monthDataset(chart: 'bar' | 'line', series: Series): Dataset {
    const element = series.line ? 'line' : chart;
    const strong = typeColor(series.color, element === 'line' ? 'high' : 'medium');
    const color =
        series.emphasis === 'strong'
            ? typeColor(series.color, 'high')
            : series.emphasis === 'faded'
              ? faded(strong)
              : strong;
    const data = series.values.map(ReportFormat.plot);
    if (element === 'line') {
        return {
            type: 'line',
            label: series.label,
            data,
            borderColor: color,
            backgroundColor: color,
            pointBackgroundColor: color,
            // Chart.js draws lower orders on top: a line over bars stays visible.
            ...(chart === 'bar' ? { order: -1 } : {}),
        };
    }
    return {
        type: 'bar',
        label: series.label,
        data,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 0,
        maxBarThickness: 40,
    };
}

function breakdown(
    chart: Extract<ChartProps, { kind: 'ranked-bar' | 'donut' | 'pie' }>,
    context: ChartContext
) {
    const { format, highlight } = context;
    const donut = chart.kind !== 'ranked-bar';
    const element: ChartElement = donut ? 'doughnut' : 'bar';
    // Rows the chart does not draw, such as rows without an amount, highlight nothing in it.
    const top = highlight && topRow(context.rows, highlight.id)?.id;
    const highlighted = chart.items.some(item => item.rowId === top) ? top : undefined;
    const base = donut
        ? shades(chart.items.map(item => item.color))
        : chart.items.map(item => typeColor(item.color, 'medium'));
    const colors = chart.items.map((item, index) => {
        if (!highlighted) {
            return base[index];
        }
        if (item.rowId !== highlighted) {
            return faded(base[index]);
        }
        return donut ? base[index] : typeColor(item.color, 'high');
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
    const config: ChartConfiguration<ChartElement, number[], string> = donut
        ? {
              type: 'doughnut',
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
    return { element, horizontal: !donut, legend: false, config, tooltipLabel, axisLabel };
}
