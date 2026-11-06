/**
 * The Chart.js configuration of a report chart, for Web Awesome's chart elements: by month
 * (bars for activity, a line for positions), or the top rows of the breakdown (ranked
 * horizontal bars, or a donut). Values are drawn from the spec's decimals; tooltips show the
 * exact amounts. A highlighted breakdown row stands out, and the rest fades.
 */
import type { ChartConfiguration, ChartDataset } from 'chart.js';
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
    values: string[];
    emphasis: 'normal' | 'strong' | 'faded';
}

export function chartConfig(chart: ChartProps, context: ChartContext): ChartView {
    return 'months' in chart ? byMonth(chart, context) : breakdown(chart, context);
}

function byMonth(chart: Extract<ChartProps, { months: string[] }>, context: ChartContext) {
    const { format, highlight } = context;
    const element = chart.kind;
    const stood = highlight && chart.series.find(series => series.id === highlight.id);
    const series: Series[] = chart.series.map(entry => ({
        label: entry.label,
        color: entry.color,
        values: entry.values,
        emphasis: !highlight ? 'normal' : entry === stood ? 'strong' : 'faded',
    }));
    if (highlight && !stood && highlight.months.length === chart.months.length) {
        series.push({
            label: highlight.label,
            color: highlight.color,
            values: highlight.months,
            emphasis: 'strong',
        });
    }
    const spansYears =
        chart.months[0].slice(0, 4) !== chart.months[chart.months.length - 1].slice(0, 4);
    const datasets = series.map(entry => monthDataset(element, entry));
    const tooltipLabel = (datasetIndex: number, dataIndex: number) =>
        `${series[datasetIndex].label}: ${format.amount(series[datasetIndex].values[dataIndex])}`;
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
                legend: { display: series.length > 1, position: 'bottom' },
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

function monthDataset(element: 'bar' | 'line', series: Series): Dataset {
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

function breakdown(chart: Extract<ChartProps, { items: unknown[] }>, context: ChartContext) {
    const { format, highlight } = context;
    const donut = chart.kind === 'donut';
    const element: ChartElement = donut ? 'doughnut' : 'bar';
    const highlighted = highlight && topRow(context.rows, highlight.id)?.id;
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
        `${chart.items[dataIndex].label}: ${format.amount(chart.items[dataIndex].value)}`;
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
                      },
                  ],
              },
              options: {
                  plugins: { title: { display: false }, legend: { display: false }, tooltip },
                  scales: { x: { ticks: { callback: value => axisLabel(Number(value)) } } },
              },
          };
    return { element, horizontal: !donut, legend: false, config, tooltipLabel, axisLabel };
}
