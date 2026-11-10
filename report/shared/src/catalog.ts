/**
 * The json-render catalog of a report: the components a report spec is made of, their props,
 * and the actions they may trigger. The server builds specs from it; renderers draw them.
 *
 * A spec is the standard flat json-render spec: a `root` key and an `elements` map of
 * `{ type, props, children?, on? }`. Its texts are already in the report's language, while
 * amounts, ratios, months and instants stay raw (decimal strings and ISO dates), for the
 * renderer to format with `Intl` in the report's `locale`.
 */
import { defineCatalog, defineSchema, validateSpec } from '@json-render/core';
import { z } from 'zod';

/** A plain decimal number as a string, such as `-354.3`; never a binary float. */
const Decimal = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/, 'Expected a decimal string');

/** A ratio as a decimal string, such as `0.1234` for 12.34%. */
const Ratio = Decimal;

const IsoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/** Text shown to people, already in the report's language. */
const Text = z.string().min(1).max(1000);

/** The colors of Bkper group and account types: Asset, Liability, Incoming, Outgoing, mixed. */
export const TYPE_COLOR_NAMES = ['blue', 'yellow', 'green', 'red', 'grey'] as const;
const Color = z.enum(TYPE_COLOR_NAMES);

const BkperUrl = z.url({ protocol: /^https$/, hostname: /^bkper\.app$/ });

const LanguageTag = z.string().refine(isLanguageTag, 'Expected a BCP 47 language tag');

function isLanguageTag(value: string): boolean {
    try {
        return Intl.getCanonicalLocales(value).length === 1;
    } catch {
        return false;
    }
}

export const ReportProps = z.strictObject({
    title: Text,
    /** The period, or the date of a position. */
    subtitle: Text,
    /** Language of the texts, and the locale to format numbers and dates in. */
    locale: LanguageTag,
    dir: z.enum(['ltr', 'rtl']),
    /** Decimal places of the Book's amounts. */
    fractionDigits: z.int().min(0).max(8),
    /**
     * The request the report answers, as a person would type it: its title and its period as
     * asked, relative words staying relative, such as `Expenses last year vs. 2023`.
     */
    request: Text.optional(),
    /**
     * What the report could not do as asked, and what it shows instead: a comparison it could
     * not make, or a chart asked for that does not fit, with why.
     */
    notice: Text.optional(),
});

const AnswerPart = z.strictObject({
    id: z.enum(['incoming', 'outgoing']),
    label: Text,
    amount: Decimal,
    color: Color,
    previous: Decimal.optional(),
    change: Ratio.optional(),
});

export const AnswerProps = z.strictObject({
    label: Text,
    amount: Decimal,
    color: Color,
    /** The amount of the period compared with. */
    previous: Decimal.optional(),
    /** `(amount - previous) / |previous|`; absent when there is nothing to compare with. */
    change: Ratio.optional(),
    /** What the amount is compared with, such as `vs. 2025`. */
    comparison: Text.optional(),
    /** The Incoming and Outgoing sides of a net result. */
    parts: z.array(AnswerPart).max(2).optional(),
});

const ChartSeries = z.strictObject({
    /** A breakdown row, the root, a side of a net result or the net result; `other` for the rest. */
    id: z.string().min(1),
    label: Text,
    color: Color,
    /** Drawn as a line over the bars of a bar chart, as a net result over its sides. */
    line: z.literal(true).optional(),
    /** One value per month of the chart. */
    values: z.array(Decimal),
});

const ChartItem = z.strictObject({
    /** The breakdown row this item shows. */
    rowId: z.string().min(1),
    label: Text,
    color: Color,
    value: Decimal,
});

const CompareItem = z.strictObject({
    rowId: z.string().min(1),
    label: Text,
    color: Color,
    /** The amount in the period. */
    value: Decimal,
    /** The amount in the previous period, or the position at its end. */
    previous: Decimal,
});

/** The first or last bar of a bridge, standing on zero. */
const WaterfallBar = z.strictObject({ label: Text, color: Color, value: Decimal });

/** A floating bar of a bridge: what it adds to the bars before it, negative when it lowers them. */
const WaterfallStep = z.strictObject({
    /** The breakdown row, at any depth; absent for the smaller parts together. */
    rowId: z.string().min(1).optional(),
    label: Text,
    color: Color,
    value: Decimal,
});

function oneValuePerMonth(
    chart: { months: string[]; series: { values: string[] }[] },
    context: z.RefinementCtx
): void {
    chart.series.forEach((series, index) => {
        if (series.values.length !== chart.months.length) {
            context.addIssue({
                code: 'custom',
                path: ['series', index, 'values'],
                message: 'Needs one value per month of the months',
            });
        }
    });
}

export const ChartProps = z
    .discriminatedUnion('kind', [
        /** By month: bars for activity, a line for positions, or areas. */
        z
            .strictObject({
                kind: z.enum(['bar', 'line', 'area']),
                label: Text,
                months: z.array(IsoMonth).min(1),
                series: z.array(ChartSeries).min(1),
            })
            .superRefine(oneValuePerMonth),
        /** By month, the parts stacked: in every month the series add up to the report's amount. */
        z
            .strictObject({
                kind: z.literal('stacked'),
                label: Text,
                months: z.array(IsoMonth).min(2),
                series: z.array(ChartSeries.omit({ line: true })).min(2),
            })
            .superRefine(oneValuePerMonth),
        /** The top breakdown rows, in breakdown order. */
        z.strictObject({
            kind: z.enum(['ranked-bar', 'donut']),
            label: Text,
            items: z.array(ChartItem).min(1),
        }),
        /** Each breakdown row in the period and in the previous one, side by side. */
        z.strictObject({
            kind: z.literal('compare'),
            label: Text,
            /** The names of the period and the previous one, for the legend. */
            periods: z.strictObject({ current: Text, previous: Text }),
            items: z.array(CompareItem).min(1),
        }),
        /** A bridge: `start`, plus every step, makes `end`. */
        z.strictObject({
            kind: z.literal('waterfall'),
            label: Text,
            start: WaterfallBar,
            steps: z.array(WaterfallStep).min(1),
            end: WaterfallBar,
        }),
    ])
    // Named, so OpenAPI references it from the Chart and from each view instead of repeating it.
    .meta({ id: 'ChartProps' });

/**
 * Every way a report can be shown: its chart kinds, and `table`, the breakdown table alone
 * with no chart.
 */
export const VIEW_KINDS = [
    'bar',
    'line',
    'area',
    'stacked',
    'ranked-bar',
    'donut',
    'compare',
    'waterfall',
    'table',
] as const satisfies readonly (z.infer<typeof ChartProps>['kind'] | 'table')[];

export type ViewKind = (typeof VIEW_KINDS)[number];

const ViewKindSchema = z.enum(VIEW_KINDS);

const ChartView = z.strictObject({
    kind: ViewKindSchema,
    /** A short name, such as `Donut`, under its preview. */
    name: Text,
    /** What to draw; absent for the table and for the main chart, which is the report's Chart. */
    chart: ChartProps.optional(),
});

/**
 * Every chart that fits the report, the main one among them, with the data of each other one,
 * so a renderer can show any of them with no network. A chart asked for that does not fit is
 * said in the Report's `notice`.
 */
export const VisualizationsProps = z
    .strictObject({
        /** Names the choice of charts, for assistive technologies. */
        label: Text,
        /** The chart the report shows first: its Chart, or none for the table. */
        main: ViewKindSchema,
        /** In the order to offer them. */
        views: z.array(ChartView).min(1),
        /** No longer given: the Report's `notice` says why a chart asked for is not shown. */
        unfit: z.strictObject({ kind: ViewKindSchema, name: Text, reason: Text }).optional(),
    })
    .superRefine((props, context) => {
        const kinds = props.views.map(view => view.kind);
        if (new Set(kinds).size !== kinds.length) {
            context.addIssue({ code: 'custom', path: ['views'], message: 'Repeats a kind' });
        }
        if (!kinds.includes(props.main)) {
            context.addIssue({ code: 'custom', path: ['main'], message: 'Not among the views' });
        }
        if (props.unfit && kinds.includes(props.unfit.kind)) {
            context.addIssue({
                code: 'custom',
                path: ['unfit', 'kind'],
                message: 'A view that fits is not unfit',
            });
        }
        props.views.forEach((view, index) => {
            const drawn = view.kind !== 'table' && view.kind !== props.main;
            if (drawn ? view.chart?.kind !== view.kind : view.chart !== undefined) {
                context.addIssue({
                    code: 'custom',
                    path: ['views', index, 'chart'],
                    message: drawn
                        ? `Needs the data of a ${view.kind} chart`
                        : 'Has its data in the Chart, or none',
                });
            }
        });
    });

export interface BreakdownRow {
    /** Group or account id; `<groupId>:other`; `incoming` or `outgoing`. */
    id: string;
    kind: 'group' | 'account' | 'other' | 'incoming' | 'outgoing';
    label: string;
    color: (typeof TYPE_COLOR_NAMES)[number];
    amount: string;
    previous?: string;
    change?: string;
    /** Ratio of the parent's amount. */
    share?: string;
    /** One amount per month of the table. */
    months: string[];
    children: BreakdownRow[];
}

const BreakdownRowSchema: z.ZodType<BreakdownRow> = z
    .strictObject({
        id: z.string().min(1),
        kind: z.enum(['group', 'account', 'other', 'incoming', 'outgoing']),
        label: Text,
        color: Color,
        amount: Decimal,
        previous: Decimal.optional(),
        change: Ratio.optional(),
        share: Ratio.optional(),
        months: z.array(Decimal),
        get children() {
            return z.array(BreakdownRowSchema);
        },
    })
    // Named, so JSON Schema and OpenAPI generators reference the recursion instead of expanding it.
    .meta({ id: 'BreakdownRow' });

/** The row under the others that totals them, as the net result of Incoming and Outgoing. */
const BreakdownTotal = z.strictObject({
    label: Text,
    color: Color,
    amount: Decimal,
    previous: Decimal.optional(),
    change: Ratio.optional(),
    /** One amount per month of the table. */
    months: z.array(Decimal),
});

export const BreakdownTableProps = z
    .strictObject({
        label: Text,
        months: z.array(IsoMonth),
        columns: z.strictObject({
            name: Text,
            amount: Text,
            share: Text,
            change: Text,
            trend: Text,
        }),
        expandLabel: Text,
        collapseLabel: Text,
        /** Shown when there are no rows. */
        emptyLabel: Text,
        /** Sorted by size; children expand in place. */
        rows: z.array(BreakdownRowSchema),
        total: BreakdownTotal.optional(),
    })
    .superRefine((table, context) => {
        if (table.total && table.total.months.length !== table.months.length) {
            context.addIssue({
                code: 'custom',
                path: ['total', 'months'],
                message: 'Needs one amount per month of the months',
            });
        }
        const check = (rows: BreakdownRow[], path: (string | number)[]): void =>
            rows.forEach((row, index) => {
                if (row.months.length !== table.months.length) {
                    context.addIssue({
                        code: 'custom',
                        path: [...path, index, 'months'],
                        message: 'Needs one amount per month of the months',
                    });
                }
                check(row.children, [...path, index, 'children']);
            });
        check(table.rows, ['rows']);
    });

export const SourceProps = z.strictObject({
    /** States the Book the numbers come from. */
    footer: Text,
    /** The exact dates read. */
    period: Text,
    /** The Bkper query of exactly the transactions and dates of the report. */
    query: z.string().min(1).max(10000),
    /** The query in Bkper. */
    url: BkperUrl,
    /** When the balances were read. */
    dataAt: z.iso.datetime(),
    /**
     * A net result Report calculated itself, not Bkper, as the Book has no group that combines
     * Incoming and Outgoing: the label that says so, and a note on how and what to add.
     */
    calculated: z.strictObject({ label: Text, note: Text }).optional(),
    labels: z.strictObject({
        source: Text,
        period: Text,
        query: Text,
        dataAt: Text,
        open: Text,
        /**
         * The control that shows the period, query, time read and footer, which are hidden
         * until asked for. Specs written before it have none; renderers then use `source`.
         */
        details: Text.optional(),
    }),
});

/** Expands or collapses a breakdown row in place; the renderer passes the row. */
export const ExpandRowParams = z.strictObject({ rowId: z.string().min(1) });

/** Shows one of the views as the report's chart, in place; the renderer passes the kind. */
export const SelectChartParams = z.strictObject({ kind: ViewKindSchema });

/** Opens a Bkper link; only where the renderer can navigate (the web app). */
export const OpenInBkperParams = z.strictObject({ url: BkperUrl });

const reportSchema = defineSchema(s => ({
    spec: s.object({
        root: s.string(),
        elements: s.record(
            s.object({
                type: s.ref('catalog.components'),
                props: s.propsOf('catalog.components'),
                children: { ...s.array(s.string()), ...s.optional() },
                on: {
                    ...s.record(
                        s.object({
                            action: s.ref('catalog.actions'),
                            params: { ...s.record(s.string()), ...s.optional() },
                        })
                    ),
                    ...s.optional(),
                },
            })
        ),
    }),
    catalog: s.object({
        components: s.map({ props: s.zod(), description: s.string() }),
        actions: s.map({ params: s.zod(), description: s.string() }),
    }),
}));

export const reportCatalog = defineCatalog(reportSchema, {
    components: {
        Report: {
            props: ReportProps,
            description: 'The report: its title, period and language; holds the other parts.',
        },
        Answer: {
            props: AnswerProps,
            description:
                'The amount asked for, with its change from the previous period; one per group or account side by side, in order.',
        },
        Chart: {
            props: ChartProps,
            description:
                'The amount by month, its largest parts, the parts against the previous period, or a bridge to the amount.',
        },
        Visualizations: {
            props: VisualizationsProps,
            description:
                'Every chart that fits the report, with their data, to show any of them instead of the Chart.',
        },
        BreakdownTable: {
            props: BreakdownTableProps,
            description: 'The parts of the amount, a tree of groups and accounts by size.',
        },
        Source: {
            props: SourceProps,
            description: 'Where the numbers come from: Book, period, Bkper query and time read.',
        },
    },
    actions: {
        expandRow: {
            params: ExpandRowParams,
            description: 'Expand or collapse a breakdown row in place.',
        },
        selectChart: {
            params: SelectChartParams,
            description: 'Show another chart that fits the report, with no new numbers.',
        },
        openInBkper: {
            params: OpenInBkperParams,
            description: 'Open the report query in Bkper.',
        },
    },
});

const ReportElement = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.literal('Report'),
        props: ReportProps,
        children: z.array(z.string()).min(1),
    }),
    z.strictObject({ type: z.literal('Answer'), props: AnswerProps }),
    z.strictObject({ type: z.literal('Chart'), props: ChartProps }),
    z.strictObject({
        type: z.literal('Visualizations'),
        props: VisualizationsProps,
        on: z
            .strictObject({ select: z.strictObject({ action: z.literal('selectChart') }) })
            .optional(),
    }),
    z.strictObject({
        type: z.literal('BreakdownTable'),
        props: BreakdownTableProps,
        on: z
            .strictObject({ expand: z.strictObject({ action: z.literal('expandRow') }) })
            .optional(),
    }),
    z.strictObject({
        type: z.literal('Source'),
        props: SourceProps,
        on: z
            .strictObject({
                open: z.strictObject({
                    action: z.literal('openInBkper'),
                    params: OpenInBkperParams,
                }),
            })
            .optional(),
    }),
]);

export const ReportSpecSchema = z.strictObject({
    root: z.string().min(1),
    elements: z.record(z.string(), ReportElement),
});

export type ReportSpec = z.infer<typeof ReportSpecSchema>;
export type ReportElement = z.infer<typeof ReportElement>;
export type ReportComponent = ReportElement['type'];

export type ReportSpecValidation =
    { valid: true; spec: ReportSpec } | { valid: false; issues: string[] };

/**
 * Checks a spec against the catalog (components, actions and the props of each element) and
 * its structure: the root is a Report, every child exists, only the Report has children, and
 * every element is part of the report.
 */
export function validateReportSpec(input: unknown): ReportSpecValidation {
    const catalog = reportCatalog.validate(input);
    if (!catalog.success) {
        return { valid: false, issues: catalog.error ? zodIssues(catalog.error) : ['Not a spec'] };
    }
    const parsed = ReportSpecSchema.safeParse(input);
    if (!parsed.success) {
        return { valid: false, issues: zodIssues(parsed.error) };
    }
    const spec = parsed.data;
    const issues = validateSpec(spec, { checkOrphans: true }).issues.map(issue => issue.message);
    if (spec.elements[spec.root] && spec.elements[spec.root].type !== 'Report') {
        issues.push(`Root element "${spec.root}" is not a Report.`);
    }
    issues.push(...chartIssues(spec));
    return issues.length === 0 ? { valid: true, spec } : { valid: false, issues };
}

/** At most one Chart and one Visualizations, whose main view is that Chart, or no Chart for the table. */
function chartIssues(spec: ReportSpec): string[] {
    const elements = Object.values(spec.elements);
    const charts = elements.filter(element => element.type === 'Chart');
    const views = elements.filter(element => element.type === 'Visualizations');
    if (charts.length > 1 || views.length > 1) {
        return ['A report has at most one Chart and one Visualizations.'];
    }
    const [chart] = charts;
    const [visualizations] = views;
    if (visualizations?.type !== 'Visualizations') {
        return [];
    }
    const main = visualizations.props.main;
    const drawn = chart?.type === 'Chart' ? chart.props.kind : 'table';
    return drawn === main ? [] : [`The main view, ${main}, is not the Chart (${drawn}).`];
}

function zodIssues(error: z.ZodError): string[] {
    return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
}
