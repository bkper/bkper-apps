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

/** A bar's value, or a floating bar's start and end. */
function floating(value: unknown): [number, number] {
    if (!Array.isArray(value) || value.length !== 2) {
        throw new Error(`Expected a floating bar: ${JSON.stringify(value)}`);
    }
    return [Number(value[0]), Number(value[1])];
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

    it('draws a pie of the parts of a whole, shaded like a donut but without a hole', () => {
        const chart = view('revenue-pie');
        expect(chart.element).toBe('pie');
        expect(chart.legend).toBe(false);
        const [slices] = datasets(chart);
        expect(slices.type).toBe('pie');
        expect(slices.data).toEqual(
            chartOf('revenue-pie', 'pie').items.map(item => Number(item.value))
        );
        expect(new Set(slices.backgroundColor as string[]).size).toBe(slices.data.length);
        expect(chart.config.options).not.toHaveProperty('cutout');
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

    it('bridges a net result with floating bars from Incoming to the net result', () => {
        const props = chartOf('net-result-waterfall', 'waterfall');
        const chart = view('net-result-waterfall');
        expect(chart).toMatchObject({ element: 'bar', horizontal: true, legend: false });
        expect(chart.config.data.labels).toEqual([
            props.start.label,
            ...props.steps.map(step => step.label),
            props.end.label,
        ]);
        const bars = datasets(chart)[0].data.map(floating);
        expect(bars[0]).toEqual([0, Number(props.start.value)]);
        expect(bars[bars.length - 1]).toEqual([0, Number(props.end.value)]);
        // Each step floats from where the bar before it ended.
        props.steps.forEach((step, index) => {
            const [from, to] = bars[index + 1];
            expect(from).toBeCloseTo(bars[index][1], 6);
            expect(to - from).toBeCloseTo(Number(step.value), 6);
        });
        expect(bars[bars.length - 2][1]).toBeCloseTo(Number(props.end.value), 6);
    });

    it('tells steps up from steps down without color, and keeps the start and end solid', () => {
        const props = chartOf('bank-accounts-waterfall', 'waterfall');
        const ups = props.steps.flatMap((step, index) => (Number(step.value) > 0 ? [index] : []));
        const downs = props.steps.flatMap((step, index) => (Number(step.value) < 0 ? [index] : []));
        expect(ups.length).toBeGreaterThan(0);
        expect(downs.length).toBeGreaterThan(0);
        const chart = view('bank-accounts-waterfall');
        const [bars] = datasets(chart);
        const width = option(bars, 'borderWidth') as number[];
        const last = props.steps.length + 1;
        expect([width[0], width[last]]).toEqual([0, 0]);
        ups.forEach(index => expect(width[index + 1]).toBe(0));
        downs.forEach(index => expect(width[index + 1]).toBeGreaterThan(0));
        const fills = bars.backgroundColor as string[];
        expect(fills[0]).not.toContain('transparent');
        expect(fills[last]).not.toContain('transparent');
        downs.forEach(index => expect(fills[index + 1]).toContain('transparent'));
        // Every bar is labelled with its value, steps with their sign.
        expect(chart.barLabels).toEqual([
            en.compact(Number(props.start.value)),
            ...props.steps.map(step => en.signedCompact(Number(step.value))),
            en.compact(Number(props.end.value)),
        ]);
        expect(chart.config.plugins?.length).toBe(1);
        expect(chart.tooltipLabel(0, 1)).toBe(
            `${isolate(props.steps[0].label)}: ${isolate(en.signedAmount(props.steps[0].value))}`
        );
    });

    it('labels each bar past its end, or past its other end where the label does not fit', () => {
        const chart = view('loans-waterfall-pt');
        const plugin = chart.config.plugins?.[0];
        const drawn: { text: string; x: number; align: string }[] = [];
        const ctx = {
            textAlign: 'start',
            save() {},
            restore() {},
            measureText: (text: string) => ({ width: text.length * 6 }),
            fillText(text: string, x: number) {
                drawn.push({ text, x, align: this.textAlign });
            },
        };
        // Pixels of bars: the first ends near the right edge of the chart, the others do not.
        const bars = [
            { x: 395, base: 0 },
            { x: 200, base: 150 },
            { x: 210, base: 200 },
            { x: 190, base: 0 },
        ].map(({ x, base }, index) => ({
            getProps: () => ({ x, base, y: index * 20 }),
        }));
        const fake = {
            ctx,
            chartArea: { left: 0, right: 400 },
            options: { scales: { x: { ticks: { font: { size: 12, family: 'serif' } } } } },
            getDatasetMeta: () => ({ data: bars }),
        };
        plugin?.afterDatasetsDraw?.(
            fake as unknown as Parameters<NonNullable<typeof plugin.afterDatasetsDraw>>[0],
            {},
            {},
            false
        );
        expect(drawn.map(label => label.text)).toEqual(chart.barLabels);
        expect(drawn[0]).toMatchObject({ align: 'right' });
        expect(drawn[0].x).toBeLessThan(0);
        expect(drawn.slice(1).every(label => label.align === 'left')).toBe(true);
        expect(drawn[1].x).toBeGreaterThan(200);
    });

    it('bridges to a loss below zero', () => {
        const props = chartOf('net-result-loss-waterfall-ar', 'waterfall');
        expect(Number(props.end.value)).toBeLessThan(0);
        const bars = datasets(view('net-result-loss-waterfall-ar'))[0].data.map(floating);
        expect(bars[bars.length - 1]).toEqual([0, Number(props.end.value)]);
        expect(bars[bars.length - 2][1]).toBeCloseTo(Number(props.end.value), 6);
    });

    it('highlights the steps of a row, at any depth, and fades the rest', () => {
        const props = chartOf('net-result-waterfall', 'waterfall');
        const plain = datasets(view('net-result-waterfall'))[0].backgroundColor as string[];
        const rent = props.steps.findIndex(step => step.rowId === 'a-rent') + 1;
        const one = datasets(view('net-result-waterfall', 'a-rent'))[0].backgroundColor as string[];
        expect(one[rent]).toBe(plain[rent]);
        expect(one[0]).toBe(faded(plain[0]));
        // Outgoing holds every step of a row.
        const all = datasets(view('net-result-waterfall', 'outgoing'))[0]
            .backgroundColor as string[];
        props.steps.forEach((_step, index) => expect(all[index + 1]).toBe(plain[index + 1]));
        expect(all[0]).toBe(faded(plain[0]));
        // A step of its own fades the rest of the steps.
        const other = props.steps.findIndex(step => step.rowId === undefined) + 1;
        expect(other).toBeGreaterThan(0);
        expect(one[other]).toBe(faded(plain[other]));
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
