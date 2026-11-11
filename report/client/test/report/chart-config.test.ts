import { isolate } from 'report-shared/bidi';
import type { BreakdownRow, ReportElement } from 'report-shared/catalog';
import { describe, expect, it } from 'vitest';
import { chartConfig, chartSwatches, type ChartView } from '../../src/report/chart-config';
import { faded } from '../../src/report/colors';
import { ReportFormat } from '../../src/report/format';
import { elementOf, gallerySpec } from './gallery-specs';

const en = new ReportFormat('en', 2);

type ChartProps = Extract<ReportElement, { type: 'Chart' }>['props'];
type ChartKind = ChartProps['kind'];

function view(id: string, highlight?: string): ChartView {
    const spec = gallerySpec(id);
    const rows = elementOf(spec, 'BreakdownTable').props.rows;
    const find = (list: BreakdownRow[]): BreakdownRow | undefined =>
        list.map(row => (row.id === highlight ? row : find(row.children))).find(Boolean);
    const chart = chartConfig(elementOf(spec, 'Chart').props, {
        format: new ReportFormat(elementOf(spec, 'Report').props.locale, 2),
        rows,
        highlight: highlight === undefined ? undefined : find(rows),
    });
    if (!chart) {
        throw new Error(`No chart drawn for ${id}`);
    }
    return chart;
}

function datasets(chart: ChartView) {
    return chart.config.data.datasets;
}

function chartOf<K extends ChartKind>(id: string, kind: K): Extract<ChartProps, { kind: K }> {
    const chart = elementOf(gallerySpec(id), 'Chart').props;
    if (chart.kind !== kind) {
        throw new Error(`Expected a ${kind} chart in ${id}, not ${chart.kind}`);
    }
    return chart as Extract<ChartProps, { kind: K }>;
}

function option(dataset: object, key: string): unknown {
    return Reflect.get(dataset, key);
}

describe('chartConfig', () => {
    it('draws activity by month as bars in the type color, one label per month', () => {
        const chart = view('expenses-by-month');
        expect(chart.element).toBe('bar');
        expect(chart.config.data.labels).toEqual([
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
        ]);
        expect(datasets(chart)).toHaveLength(1);
        expect(datasets(chart)[0]).toMatchObject({
            label: 'Expenses',
            backgroundColor: 'var(--bkper-color-red-medium)',
        });
        expect(chart.legend).toBe(false);
    });

    it('draws positions by month as a line', () => {
        const chart = view('bank-accounts-by-month');
        expect(chart.element).toBe('line');
        expect(datasets(chart)[0]).toMatchObject({ borderColor: 'var(--bkper-color-blue-high)' });
    });

    it('draws the roots of a net result as positive bars under a line of the net result', () => {
        const chart = view('net-result-by-month-pt');
        const spec = gallerySpec('net-result-by-month-pt');
        const rows = elementOf(spec, 'BreakdownTable').props.rows;
        expect(datasets(chart).map(dataset => [dataset.label, dataset.type])).toEqual([
            ...rows.map(row => [row.label, 'bar']),
            [elementOf(spec, 'Report').props.title, 'line'],
        ]);
        expect(datasets(chart)[0].backgroundColor).toBe('var(--bkper-color-green-medium)');
        expect(datasets(chart)[1].backgroundColor).toBe('var(--bkper-color-red-medium)');
        expect(datasets(chart)[3].borderColor).toBe('var(--bkper-color-grey-high)');
        expect(datasets(chart)[1].data.every(value => Number(value) > 0)).toBe(true);
        expect(chart.legend).toBe(true);
        const sort = chart.config.options?.plugins?.legend?.labels?.sort;
        const items = [3, 0, 2, 1].map(datasetIndex => ({ text: '', datasetIndex }));
        expect(
            sort &&
                [...items].sort((a, b) => sort(a, b, chart.config.data)).map(i => i.datasetIndex)
        ).toEqual([0, 1, 2, 3]);
    });

    it('tells apart series of one type color by month, the first in its usual tone', () => {
        const chart = view('targets-by-month');
        const colors = datasets(chart).map(dataset => dataset.backgroundColor);
        expect(colors[0]).toBe('var(--bkper-color-red-medium)');
        expect(new Set(colors).size).toBe(colors.length);
        expect(chart.legend).toBe(true);
    });

    it('labels months with their year when the chart spans years', () => {
        const chart = view('net-income-last-12-months-ar');
        expect(chart.config.data.labels?.[0]).toBe(
            new ReportFormat('ar', 2).month('2025-12', 'year')
        );
    });

    it('ranks a breakdown as horizontal bars, largest first', () => {
        const chart = view('expenses-breakdown');
        expect(chart).toMatchObject({ element: 'bar', horizontal: true, legend: false });
        expect(chart.config.data.labels?.slice(0, 3)).toEqual(['People', 'Office', 'Marketing']);
        expect(datasets(chart)[0].data.slice(0, 2)).toEqual([190099.76, 47311.68]);
    });

    it('draws a negative ranked value the other way from zero, visible however small', () => {
        const chart = chartConfig(
            {
                kind: 'ranked-bar',
                label: 'Assets by part',
                items: [
                    { rowId: 'bank', label: 'Bank Account', color: 'blue', value: '10090' },
                    { rowId: 'cash', label: 'Cash', color: 'blue', value: '-4' },
                ],
            },
            { format: en, rows: [] }
        );
        const [bars] = datasets(chart);
        expect(bars.data).toEqual([10090, -4]);
        expect(bars.backgroundColor).toEqual([
            'var(--bkper-color-blue-medium)',
            'var(--bkper-color-blue-medium)',
        ]);
        expect('minBarLength' in bars && Number(bars.minBarLength) > 0).toBe(true);
        // Room beyond zero for the bars that go the other way.
        expect(chart.config.options?.scales?.x).toMatchObject({ grace: expect.any(String) });
    });

    it('shades the slices of a donut of one type from strong to light', () => {
        const chart = view('revenue-donut-ja');
        expect(chart.element).toBe('doughnut');
        const colors = datasets(chart)[0].backgroundColor;
        expect(colors).toHaveLength(4);
        expect(new Set(colors as string[]).size).toBe(4);
        expect((colors as string[])[0]).toContain('--bkper-color-green-high');
    });

    it('highlights the row of a breakdown and fades the others', () => {
        const plain = datasets(view('expenses-breakdown'))[0].backgroundColor as string[];
        const office = datasets(view('expenses-breakdown', 'g-office'))[0]
            .backgroundColor as string[];
        expect(office[1]).toBe('var(--bkper-color-red-high)');
        expect(office[0]).not.toBe(plain[0]);
        expect(office[0]).toContain('transparent');
    });

    it('highlights the top-level row of a nested row in a breakdown', () => {
        const colors = datasets(view('expenses-breakdown', 'a-rent'))[0]
            .backgroundColor as string[];
        expect(colors[1]).toBe('var(--bkper-color-red-high)');
    });

    it('adds the months of a highlighted row to a chart by month', () => {
        const chart = view('expenses-by-month', 'g-people');
        expect(datasets(chart).map(dataset => dataset.label)).toEqual(['Expenses', 'People']);
        expect(datasets(chart)[1].data).toHaveLength(12);
        expect(datasets(chart)[0].backgroundColor).toContain('transparent');
    });

    it('emphasizes the series a highlighted row stands for', () => {
        const chart = view('net-result-by-month-pt', 'g-expenses');
        expect(datasets(chart)).toHaveLength(4);
        expect(datasets(chart)[0].backgroundColor).toContain('transparent');
        expect(datasets(chart)[1].backgroundColor).toBe('var(--bkper-color-red-high)');
        expect(datasets(chart)[3].borderColor).toContain('transparent');
    });

    it('leaves a highlighted row without amount out of a chart by month', () => {
        const spec = gallerySpec('taxes-donut');
        const table = elementOf(spec, 'BreakdownTable').props;
        const property = table.rows.find(row => row.label === 'Property tax');
        expect(property?.amount).toBe('0');
        const chart = chartConfig(
            {
                kind: 'bar',
                label: 'Taxes by month',
                months: table.months,
                series: [{ id: 'g-taxes', label: 'Taxes', color: 'red', values: ['1', '2', '3'] }],
            },
            { format: en, rows: table.rows, highlight: property }
        );
        expect(datasets(chart).map(dataset => dataset.label)).toEqual(['Taxes']);
        expect(datasets(chart)[0].backgroundColor).toBe('var(--bkper-color-red-medium)');
    });

    it('fades nothing in a breakdown chart for a highlighted row it does not draw', () => {
        const plain = datasets(view('taxes-donut'))[0].backgroundColor;
        const property = elementOf(gallerySpec('taxes-donut'), 'BreakdownTable').props.rows.find(
            row => row.label === 'Property tax'
        );
        expect(datasets(view('taxes-donut', property?.id))[0].backgroundColor).toEqual(plain);
    });

    it('draws a donut for a pie asked for, a shade for each part of the whole', () => {
        const chart = view('revenue-donut');
        expect(chart.element).toBe('doughnut');
        expect(chart.legend).toBe(false);
        const [slices] = datasets(chart);
        expect(slices.type).toBe('doughnut');
        expect(slices.data).toEqual(
            chartOf('revenue-donut', 'donut').items.map(item => Number(item.value))
        );
        expect(new Set(slices.backgroundColor as string[]).size).toBe(slices.data.length);
        expect(chart.config.options).toHaveProperty('cutout');
    });

    it('fills the areas of a chart by month from zero, and keeps the net result a line', () => {
        const positions = view('bank-accounts-area');
        expect(positions.element).toBe('line');
        expect(datasets(positions)[0]).toMatchObject({ type: 'line', fill: 'origin' });
        expect(String(datasets(positions)[0].backgroundColor)).toContain('transparent');
        expect(positions.config.options?.scales?.y).toMatchObject({ beginAtZero: true });

        const net = view('net-result-area-ar');
        const series = chartOf('net-result-area-ar', 'area').series;
        expect(datasets(net).map(dataset => option(dataset, 'fill'))).toEqual(
            series.map(entry => (entry.line ? false : 'origin'))
        );
        expect(net.legend).toBe(true);
    });

    it('stacks a series per part by month, each in its own shade, adding up to the whole', () => {
        const chart = view('expenses-stacked');
        const series = chartOf('expenses-stacked', 'stacked').series;
        expect(chart.element).toBe('bar');
        expect(chart.config.options?.scales).toMatchObject({
            x: { stacked: true },
            y: { stacked: true },
        });
        expect(datasets(chart).map(dataset => dataset.label)).toEqual(
            series.map(entry => entry.label)
        );
        const colors = datasets(chart).map(dataset => dataset.backgroundColor);
        expect(new Set(colors).size).toBe(series.length);
        expect(chart.legend).toBe(true);
        // A line of the surface between parts keeps neighbouring shades apart.
        expect(option(datasets(chart)[0], 'borderWidth')).toBeGreaterThan(0);
        // The table's swatches name each part's color.
        const swatches = chartSwatches(chartOf('expenses-stacked', 'stacked'));
        expect(swatches.get(series[0].id)).toBe(colors[0]);
    });

    it('highlights the series of a part in a stacked chart without adding one', () => {
        const series = chartOf('expenses-stacked', 'stacked').series;
        const people = view('expenses-stacked', 'g-people');
        expect(datasets(people)).toHaveLength(series.length);
        expect(String(datasets(people)[0].backgroundColor)).not.toContain('transparent');
        expect(String(datasets(people)[1].backgroundColor)).toContain('transparent');
        // A nested row highlights the part it is in.
        const rent = view('expenses-stacked', 'a-rent');
        const office = series.findIndex(entry => entry.id === 'g-office');
        expect(String(datasets(rent)[office].backgroundColor)).not.toContain('transparent');
        expect(String(datasets(rent)[0].backgroundColor)).toContain('transparent');
    });

    it('pairs each part now and before, the previous period outlined, with both in a legend', () => {
        const chart = view('expenses-compare');
        const props = chartOf('expenses-compare', 'compare');
        expect(chart).toMatchObject({ element: 'bar', horizontal: true, legend: true });
        expect(chart.config.data.labels).toEqual(props.items.map(item => item.label));
        const [previous, current] = datasets(chart);
        expect([previous.label, current.label]).toEqual([
            props.periods.previous,
            props.periods.current,
        ]);
        expect(current.data).toEqual(props.items.map(item => Number(item.value)));
        expect(previous.data).toEqual(props.items.map(item => Number(item.previous)));
        // Told apart by more than color: the previous period is an outline.
        expect(Number(option(previous, 'borderWidth'))).toBeGreaterThan(0);
        expect(Number(option(current, 'borderWidth'))).toBe(0);
        expect(chart.config.options?.plugins?.legend).toMatchObject({ display: true });
        expect(chart.tooltipLabel(0, 0)).toBe(
            `${isolate(props.periods.previous)}: ${isolate(en.amount(props.items[0].previous))}`
        );
    });

    it('compares negative parts the other way from zero, and draws no bar for nothing', () => {
        const props = chartOf('mixed-compare', 'compare');
        const chart = view('mixed-compare');
        const [, current] = datasets(chart);
        expect(current.data.some(value => Number(value) < 0)).toBe(true);
        expect(chart.config.options?.scales?.x).toMatchObject({ grace: expect.any(String) });
        const zero = chartConfig(
            {
                ...props,
                items: [{ ...props.items[0], previous: '0' }],
            },
            { format: en, rows: [] }
        );
        expect(datasets(zero)[0].data).toEqual([null]);
    });

    it('highlights the part of a comparison in both periods', () => {
        const plain = datasets(view('expenses-compare'));
        datasets(view('expenses-compare', 'g-office')).forEach((dataset, index) => {
            const colors = dataset.backgroundColor as string[];
            const before = plain[index].backgroundColor as string[];
            expect(colors[1]).toBe(before[1]);
            expect(colors[0]).toBe(faded(before[0]));
        });
    });

    it('formats tooltips with the exact amounts and axes compactly', () => {
        const chart = view('expenses-by-month');
        const label = chart.config.options?.plugins?.tooltip?.callbacks?.label;
        expect(typeof label).toBe('function');
        // Each isolated, so a name and an amount read in order in either direction.
        expect(chart.tooltipLabel(0, 0)).toBe(
            `${isolate('Expenses')}: ${isolate(en.amount(firstMonthValue()))}`
        );
        expect(chart.axisLabel(12500)).toBe('12.5K');
    });
});

function firstMonthValue(): string {
    const chart = elementOf(gallerySpec('expenses-by-month'), 'Chart').props;
    if (chart.kind !== 'bar' && chart.kind !== 'line') {
        throw new Error('Expected a chart by month');
    }
    return chart.series[0].values[0];
}
