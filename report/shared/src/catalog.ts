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
    id: z.string().min(1),
    label: Text,
    color: Color,
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

export const ChartProps = z.discriminatedUnion('kind', [
    /** By month: bars for activity, a line for positions. */
    z
        .strictObject({
            kind: z.enum(['bar', 'line']),
            label: Text,
            months: z.array(IsoMonth).min(1),
            series: z.array(ChartSeries).min(1),
        })
        .superRefine((chart, context) => {
            chart.series.forEach((series, index) => {
                if (series.values.length !== chart.months.length) {
                    context.addIssue({
                        code: 'custom',
                        path: ['series', index, 'values'],
                        message: 'Needs one value per month of the months',
                    });
                }
            });
        }),
    /** The top breakdown rows, in breakdown order. */
    z.strictObject({
        kind: z.enum(['ranked-bar', 'donut']),
        label: Text,
        items: z.array(ChartItem).min(1),
    }),
]);

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
    })
    .superRefine((table, context) => {
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
    labels: z.strictObject({
        source: Text,
        period: Text,
        query: Text,
        dataAt: Text,
        open: Text,
    }),
});

/** Expands or collapses a breakdown row in place; the renderer passes the row. */
export const ExpandRowParams = z.strictObject({ rowId: z.string().min(1) });

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
            description: 'The amount asked for, with its change from the previous period.',
        },
        Chart: {
            props: ChartProps,
            description: 'The amount by month, or its largest parts.',
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
    return issues.length === 0 ? { valid: true, spec } : { valid: false, issues };
}

function zodIssues(error: z.ZodError): string[] {
    return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
}
