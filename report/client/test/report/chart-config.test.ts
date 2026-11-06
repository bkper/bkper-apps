import { isolate } from 'report-shared/bidi';
import type { BreakdownRow } from 'report-shared/catalog';
import { describe, expect, it } from 'vitest';
import { chartConfig, type ChartView } from '../../src/report/chart-config';
import { ReportFormat } from '../../src/report/format';
import { elementOf, gallerySpec } from './gallery-specs';

const en = new ReportFormat('en', 2);

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

    it('draws Incoming and Outgoing as positive bars under a line of the net result', () => {
        const chart = view('net-result-by-month-pt');
        const spec = gallerySpec('net-result-by-month-pt');
        const [incoming, outgoing] = elementOf(spec, 'Answer').props.parts ?? [];
        expect(datasets(chart).map(dataset => [dataset.label, dataset.type])).toEqual([
            [incoming?.label, 'bar'],
            [outgoing?.label, 'bar'],
            [elementOf(spec, 'Report').props.title, 'line'],
        ]);
        expect(datasets(chart)[0].backgroundColor).toBe('var(--bkper-color-green-medium)');
        expect(datasets(chart)[1].backgroundColor).toBe('var(--bkper-color-red-medium)');
        expect(datasets(chart)[2].borderColor).toBe('var(--bkper-color-grey-high)');
        expect(datasets(chart)[1].data.every(value => value > 0)).toBe(true);
        expect(chart.legend).toBe(true);
        const sort = chart.config.options?.plugins?.legend?.labels?.sort;
        const items = [2, 0, 1].map(datasetIndex => ({ text: '', datasetIndex }));
        expect(
            sort &&
                [...items].sort((a, b) => sort(a, b, chart.config.data)).map(i => i.datasetIndex)
        ).toEqual([0, 1, 2]);
    });

    it('labels months with their year when the chart spans years', () => {
        const chart = view('net-result-last-12-months-ar');
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
        const chart = view('net-result-by-month-pt', 'outgoing');
        expect(datasets(chart)).toHaveLength(3);
        expect(datasets(chart)[0].backgroundColor).toContain('transparent');
        expect(datasets(chart)[1].backgroundColor).toBe('var(--bkper-color-red-high)');
        expect(datasets(chart)[2].borderColor).toContain('transparent');
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
