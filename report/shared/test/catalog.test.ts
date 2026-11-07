import { describe, expect, it } from 'vitest';
import { reportCatalog, validateReportSpec, type ReportSpec } from '../src/catalog';

function validSpec(): ReportSpec {
    return {
        root: 'report',
        elements: {
            report: {
                type: 'Report',
                props: {
                    title: 'Expenses',
                    subtitle: 'October 2026',
                    locale: 'pt-BR',
                    dir: 'ltr',
                    fractionDigits: 2,
                },
                children: ['answer', 'chart', 'breakdown', 'source'],
            },
            answer: {
                type: 'Answer',
                props: {
                    label: 'Expenses',
                    amount: '1234.5',
                    color: 'red',
                    previous: '1000',
                    change: '0.2345',
                    comparison: 'vs. September 2026',
                },
            },
            chart: {
                type: 'Chart',
                props: {
                    kind: 'bar',
                    label: 'Expenses by month',
                    months: ['2026-09', '2026-10'],
                    series: [
                        { id: 'g-1', label: 'Expenses', color: 'red', values: ['1000', '1234.5'] },
                    ],
                },
            },
            breakdown: {
                type: 'BreakdownTable',
                props: {
                    label: 'Breakdown',
                    months: ['2026-09', '2026-10'],
                    columns: {
                        name: 'Name',
                        amount: 'Amount',
                        share: 'Share',
                        change: 'Change',
                        trend: 'By month',
                    },
                    expandLabel: 'Expand',
                    collapseLabel: 'Collapse',
                    emptyLabel: 'No balances in this period.',
                    rows: [
                        {
                            id: 'g-2',
                            kind: 'group',
                            label: 'Office',
                            color: 'red',
                            amount: '1234.5',
                            previous: '1000',
                            change: '0.2345',
                            share: '1',
                            months: ['1000', '1234.5'],
                            children: [
                                {
                                    id: 'g-2:other',
                                    kind: 'other',
                                    label: 'Other',
                                    color: 'red',
                                    amount: '1234.5',
                                    months: ['1000', '1234.5'],
                                    children: [],
                                },
                            ],
                        },
                    ],
                },
                on: { expand: { action: 'expandRow' } },
            },
            source: {
                type: 'Source',
                props: {
                    footer: 'Computed from the balances of Test Ledger',
                    period: 'Oct 1 – 31, 2026',
                    query: "group:'Expenses' after:2026-10-01 before:2026-11-01",
                    url: 'https://bkper.app/books/book-1/transactions?query=x',
                    dataAt: '2026-11-05T15:00:00.000Z',
                    labels: {
                        source: 'Source',
                        period: 'Period',
                        query: 'Query',
                        dataAt: 'Balances read',
                        open: 'Open in Bkper',
                    },
                },
                on: {
                    open: { action: 'openInBkper', params: { url: 'https://bkper.app/books/x' } },
                },
            },
        },
    };
}

/** A valid spec with one change. */
function changed(change: (spec: ReportSpec) => void): unknown {
    const spec = validSpec();
    change(spec);
    return spec;
}

function issuesOf(spec: unknown): string[] {
    const result = validateReportSpec(spec);
    return result.valid ? [] : result.issues;
}

describe('reportCatalog', () => {
    it('has the report components and actions', () => {
        expect(reportCatalog.componentNames).toEqual([
            'Report',
            'Answer',
            'Chart',
            'Visualizations',
            'BreakdownTable',
            'Source',
        ]);
        expect(reportCatalog.actionNames).toEqual(['expandRow', 'selectChart', 'openInBkper']);
    });
});

describe('validateReportSpec', () => {
    it('accepts a valid spec', () => {
        expect(issuesOf(validSpec())).toEqual([]);
    });

    it('accepts breakdown charts and a net result answer', () => {
        const spec = changed(spec => {
            spec.elements.chart = {
                type: 'Chart',
                props: {
                    kind: 'donut',
                    label: 'Breakdown of Expenses',
                    items: [{ rowId: 'g-2', label: 'Office', color: 'red', value: '1234.5' }],
                },
            };
            spec.elements.answer = {
                type: 'Answer',
                props: {
                    label: 'Net result',
                    amount: '-10',
                    color: 'grey',
                    parts: [
                        { id: 'incoming', label: 'Incoming', amount: '5', color: 'green' },
                        { id: 'outgoing', label: 'Outgoing', amount: '15', color: 'red' },
                    ],
                },
            };
        });
        expect(issuesOf(spec)).toEqual([]);
    });

    it('accepts a Source that says Report calculated the net result, and rejects a bare one', () => {
        const calculated = (value: unknown) =>
            changed(spec => {
                const source = spec.elements.source;
                if (source.type === 'Source') {
                    Object.assign(source.props, { calculated: value });
                }
            });
        expect(
            issuesOf(
                calculated({ label: 'Calculated by Report', note: 'Incoming minus Outgoing.' })
            )
        ).toEqual([]);
        expect(issuesOf(calculated({ label: 'Calculated by Report' }))).not.toEqual([]);
    });

    it('accepts a net result as a line over the bars and as the total of the table', () => {
        const spec = changed(spec => {
            const chart = spec.elements.chart;
            if (chart.type === 'Chart' && 'series' in chart.props) {
                chart.props.series.push({
                    id: 'net-result',
                    label: 'Net result',
                    color: 'grey',
                    line: true,
                    values: ['-5', '10'],
                });
            }
            const table = spec.elements.breakdown;
            if (table.type === 'BreakdownTable') {
                table.props.total = {
                    label: 'Net result',
                    color: 'grey',
                    amount: '10',
                    previous: '-5',
                    change: '3',
                    months: ['-5', '10'],
                };
            }
        });
        expect(issuesOf(spec)).toEqual([]);
    });

    const months = ['2026-09', '2026-10'];
    const series = (id: string, values = ['1000', '1234.5']) => ({
        id,
        label: id,
        color: 'red' as const,
        values,
    });
    const item = (rowId: string, value: string) => ({
        rowId,
        label: rowId,
        color: 'red' as const,
        value,
    });
    const charts: Record<string, unknown> = {
        bar: { kind: 'bar', label: 'By month', months, series: [series('g-1')] },
        line: { kind: 'line', label: 'By month', months, series: [series('g-1')] },
        area: { kind: 'area', label: 'By month', months, series: [series('g-1')] },
        stacked: {
            kind: 'stacked',
            label: 'By month',
            months,
            series: [series('a-1', ['600', '1000']), series('other', ['400', '234.5'])],
        },
        'ranked-bar': { kind: 'ranked-bar', label: 'Parts', items: [item('a-1', '-3')] },
        donut: { kind: 'donut', label: 'Parts', items: [item('a-1', '3'), item('a-2', '1')] },
        pie: { kind: 'pie', label: 'Parts', items: [item('a-1', '3'), item('a-2', '1')] },
        compare: {
            kind: 'compare',
            label: 'Parts',
            periods: { current: 'October 2026', previous: 'September 2026' },
            items: [{ ...item('a-1', '3'), previous: '0' }],
        },
        waterfall: {
            kind: 'waterfall',
            label: 'Bridge',
            start: { label: 'Incoming', color: 'green', value: '5000' },
            steps: [item('a-1', '-1000'), { label: 'Other', color: 'red', value: '-50.25' }],
            end: { label: 'Net result', color: 'grey', value: '3949.75' },
        },
    };
    const withChart = (props: unknown) => {
        const spec = validSpec();
        return { ...spec, elements: { ...spec.elements, chart: { type: 'Chart', props } } };
    };

    it.each(Object.keys(charts))('accepts a %s chart', kind => {
        expect(issuesOf(withChart(charts[kind]))).toEqual([]);
    });

    it('rejects charts that miss what their kind needs', () => {
        const invalid = [
            { ...(charts.stacked as object), series: [series('a-1')] },
            {
                ...(charts.stacked as object),
                months: ['2026-10'],
                series: [series('a-1', ['1']), series('a-2', ['2'])],
            },
            {
                ...(charts.stacked as object),
                series: [{ ...series('a-1'), line: true }, series('a-2')],
            },
            { ...(charts.compare as object), items: [item('a-1', '3')] },
            { ...(charts.compare as object), periods: undefined },
            { ...(charts.waterfall as object), steps: [] },
            { ...(charts.waterfall as object), end: undefined },
            { ...(charts.pie as object), items: [{ ...item('a-1', '3'), previous: '1' }] },
            { kind: 'table', label: 'None' },
        ];
        for (const props of invalid) {
            expect(issuesOf(withChart(props)), JSON.stringify(props)).not.toEqual([]);
        }
    });

    /** The valid spec, its bar chart main among the views. */
    const withViews = (
        props: Record<string, unknown>
    ): { root: string; elements: Record<string, object> } => {
        const spec = validSpec();
        const report = spec.elements.report;
        if (report.type === 'Report') {
            report.children = ['answer', 'chart', 'views', 'breakdown', 'source'];
        }
        return {
            ...spec,
            elements: {
                ...spec.elements,
                views: {
                    type: 'Visualizations',
                    props: {
                        label: 'Charts',
                        main: 'bar',
                        views: [
                            { kind: 'bar', name: 'By month' },
                            { kind: 'pie', name: 'Pie', chart: charts.pie },
                            { kind: 'table', name: 'Table' },
                        ],
                        ...props,
                    },
                    on: { select: { action: 'selectChart' } },
                },
            },
        };
    };

    it('accepts every chart that fits, with the data of each but the main one', () => {
        expect(issuesOf(withViews({}))).toEqual([]);
        expect(
            issuesOf(
                withViews({
                    unfit: { kind: 'waterfall', name: 'Bridge', reason: 'Nothing changed' },
                })
            )
        ).toEqual([]);
    });

    it('accepts the table as the main view, with no Chart', () => {
        const spec = withViews({
            main: 'table',
            views: [
                { kind: 'bar', name: 'By month', chart: charts.bar },
                { kind: 'table', name: 'Table' },
            ],
        });
        delete spec.elements.chart;
        Object.assign(spec.elements.report, {
            children: ['answer', 'views', 'breakdown', 'source'],
        });
        expect(issuesOf(spec)).toEqual([]);
    });

    it('rejects views that cannot be shown as they say', () => {
        const invalid = [
            // Data for another kind, or none for a chart other than the main one.
            {
                views: [
                    { kind: 'bar', name: 'By month' },
                    { kind: 'pie', name: 'Pie', chart: charts.donut },
                ],
            },
            {
                views: [
                    { kind: 'bar', name: 'By month' },
                    { kind: 'pie', name: 'Pie' },
                ],
            },
            // The main chart's data is the Chart's; the table has none.
            { views: [{ kind: 'bar', name: 'By month', chart: charts.bar }] },
            {
                views: [
                    { kind: 'bar', name: 'By month' },
                    { kind: 'table', name: 'Table', chart: charts.bar },
                ],
            },
            // The main view must be among them, each once, and the unfit one not.
            { main: 'pie' },
            {
                views: [
                    { kind: 'bar', name: 'By month' },
                    { kind: 'bar', name: 'By month' },
                ],
            },
            { unfit: { kind: 'pie', name: 'Pie', reason: 'No' } },
            { views: [] },
        ];
        for (const props of invalid) {
            expect(issuesOf(withViews(props)), JSON.stringify(props)).not.toEqual([]);
        }
    });

    it('rejects a main view that is not the Chart', () => {
        const spec = withViews({
            main: 'pie',
            views: [
                { kind: 'bar', name: 'By month', chart: charts.bar },
                { kind: 'pie', name: 'Pie' },
            ],
        });
        expect(issuesOf(spec).join()).toMatch(/main view/);
        const table = withViews({
            main: 'table',
            views: [
                { kind: 'bar', name: 'By month', chart: charts.bar },
                { kind: 'table', name: 'Table' },
            ],
        });
        expect(issuesOf(table).join()).toMatch(/main view/);
    });

    it('rejects another action on the views', () => {
        const spec = withViews({});
        Object.assign(spec.elements.views, { on: { select: { action: 'expandRow' } } });
        expect(issuesOf(spec)).not.toEqual([]);
    });

    it('rejects a total whose months do not match the months', () => {
        const spec = changed(spec => {
            const table = spec.elements.breakdown;
            if (table.type === 'BreakdownTable') {
                table.props.total = { label: 'Net result', color: 'grey', amount: '1', months: [] };
            }
        });
        expect(issuesOf(spec).join()).toMatch(/breakdown.*total.*months/);
    });

    it('rejects a component the catalog does not have', () => {
        const spec = changed(spec => {
            Object.assign(spec.elements.answer, { type: 'Button' });
        });
        expect(issuesOf(spec).join()).toMatch(/type/);
    });

    it('rejects props a component does not have', () => {
        const spec = changed(spec => {
            Object.assign(spec.elements.answer.props, { onclick: 'alert(1)' });
        });
        expect(issuesOf(spec).join()).toMatch(/answer.*onclick/);
    });

    it('rejects amounts that are not decimal strings', () => {
        for (const amount of ['1e3', '1,5', '', 'NaN', ' 1']) {
            const spec = changed(spec => {
                Object.assign(spec.elements.answer.props, { amount });
            });
            expect(issuesOf(spec).join(), amount).toMatch(/answer.*amount/);
        }
        const spec = changed(spec => {
            Object.assign(spec.elements.answer.props, { amount: 1234.5 });
        });
        expect(issuesOf(spec).join()).toMatch(/answer.*amount/);
    });

    it('rejects an invalid row deep in the breakdown tree', () => {
        const spec = changed(spec => {
            const breakdown = spec.elements.breakdown;
            if (breakdown.type === 'BreakdownTable') {
                Object.assign(breakdown.props.rows[0].children[0], { color: 'purple' });
            }
        });
        expect(issuesOf(spec).join()).toMatch(/breakdown.*color/);
    });

    it('rejects monthly values that do not match the months', () => {
        const chart = changed(spec => {
            const element = spec.elements.chart;
            if (element.type === 'Chart' && 'series' in element.props) {
                element.props.series[0].values.pop();
            }
        });
        expect(issuesOf(chart).join()).toMatch(/chart.*months/);
        const table = changed(spec => {
            const element = spec.elements.breakdown;
            if (element.type === 'BreakdownTable') {
                element.props.rows[0].months.push('1');
            }
        });
        expect(issuesOf(table).join()).toMatch(/breakdown.*months/);
    });

    it('rejects a locale that is not a language tag', () => {
        const spec = changed(spec => {
            Object.assign(spec.elements.report.props, { locale: 'not a locale' });
        });
        expect(issuesOf(spec).join()).toMatch(/report.*locale/);
    });

    it('rejects a link outside Bkper', () => {
        const spec = changed(spec => {
            Object.assign(spec.elements.source.props, { url: 'javascript:alert(1)' });
        });
        expect(issuesOf(spec).join()).toMatch(/source.*url/);
    });

    it('rejects a missing child', () => {
        const spec = changed(spec => {
            delete (spec.elements as Record<string, unknown>).chart;
        });
        expect(issuesOf(spec).join()).toMatch(/chart/);
    });

    it('rejects a root that is not a Report', () => {
        const spec = changed(spec => {
            spec.root = 'answer';
        });
        expect(issuesOf(spec).join()).toMatch(/root/i);
    });

    it('rejects children under a component other than the Report', () => {
        const spec = changed(spec => {
            Object.assign(spec.elements.answer, { children: ['source'] });
        });
        expect(issuesOf(spec).join()).toMatch(/answer.*children/);
    });

    it('rejects an element that is not part of the report', () => {
        const spec = changed(spec => {
            Object.assign(spec.elements.report, { children: ['answer', 'chart', 'breakdown'] });
        });
        expect(issuesOf(spec).join()).toMatch(/source/);
    });

    it('rejects an action the catalog does not have, or wrong action params', () => {
        const unknown = changed(spec => {
            Object.assign(spec.elements.source, { on: { open: { action: 'deleteBook' } } });
        });
        expect(issuesOf(unknown).join()).toMatch(/action/);
        const params = changed(spec => {
            Object.assign(spec.elements.source, {
                on: { open: { action: 'openInBkper', params: { url: 'https://evil.example' } } },
            });
        });
        expect(issuesOf(params).join()).toMatch(/source.*url/);
    });

    it('rejects what is not a spec', () => {
        expect(issuesOf(null)).not.toEqual([]);
        expect(issuesOf({ root: 'report' })).not.toEqual([]);
    });
});
