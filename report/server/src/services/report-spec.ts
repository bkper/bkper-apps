/**
 * Report spec: the data of a report becomes a json-render spec of the report catalog, in one
 * language.
 *
 * Every text is resolved here, in the report's language: titles, period labels, row labels
 * the report names itself (Other, Incoming, Outgoing) and the labels renderers show. Group
 * and account names stay verbatim. Amounts and ratios stay the report's decimal strings, and
 * months and instants stay ISO, for renderers to format in the spec's locale.
 */
import {
    validateReportSpec,
    type BreakdownRow,
    type ReportElement,
    type ReportSpec,
    type ViewKind,
} from 'report-shared/catalog';
import { isolate } from 'report-shared/bidi';
import { t, textDirection, type StringKey } from 'report-shared/strings';
import { addDays, type DateRange, type IsoDate, type RelativePeriod } from './periods.js';
import { NET_RESULT_ROOT } from './report-intent.js';
import {
    OTHER_PART,
    TYPE_COLORS,
    viewKindOf,
    type ChartSeries,
    type ReportAmounts,
    type ReportChart,
    type ReportData,
    type ReportRow,
    type RowKind,
    type UnfitReason,
    type WaterfallStep,
} from './report.js';

const RELATIVE_PERIOD_LABELS = {
    today: 'period_today',
    this_month: 'period_this_month',
    last_month: 'period_last_month',
    this_quarter: 'period_this_quarter',
    last_quarter: 'period_last_quarter',
    this_year: 'period_this_year',
    last_year: 'period_last_year',
    ytd: 'period_ytd',
    last_12_months: 'period_last_12_months',
    all: 'period_all',
} as const satisfies Record<RelativePeriod, StringKey>;

function relativePeriodLabel(id: string): StringKey | undefined {
    return Object.entries(RELATIVE_PERIOD_LABELS).find(([period]) => period === id)?.[1];
}

const VIEW_NAMES = {
    bar: 'chart_name_bar',
    line: 'chart_name_line',
    area: 'chart_name_area',
    stacked: 'chart_name_stacked',
    'ranked-bar': 'chart_name_ranked_bar',
    donut: 'chart_name_donut',
    pie: 'chart_name_pie',
    compare: 'chart_name_compare',
    waterfall: 'chart_name_waterfall',
    table: 'chart_name_table',
} as const satisfies Record<ViewKind, StringKey>;

const UNFIT_REASONS = {
    negative_part: 'chart_unfit_negative_part',
    mixed_parts: 'chart_unfit_mixed_parts',
    few_parts: 'chart_unfit_few_parts',
    too_many_parts: 'chart_unfit_too_many_parts',
    few_months: 'chart_unfit_few_months',
    no_amounts: 'chart_unfit_no_amounts',
    no_previous: 'chart_unfit_no_previous',
    not_a_bridge: 'chart_unfit_not_a_bridge',
    no_change: 'chart_unfit_no_change',
    // Said of the chart it is about.
    net_result: 'chart_unfit_pie_net_result',
} as const satisfies Record<UnfitReason['code'], StringKey>;

const NAMED_ROWS = {
    other: 'row_other',
    incoming: 'row_incoming',
    outgoing: 'row_outgoing',
} as const satisfies Partial<Record<RowKind, StringKey>>;

/** The spec of a report in a language; it always passes the catalog's validation. */
export function buildReportSpec(report: ReportData, lang: string): ReportSpec {
    const labels = new Labels(lang);
    const title = report.root.name ?? t('report_net_result', lang);
    const subtitle = labels.period(report);
    const elements: Record<string, ReportElement> = {
        answer: { type: 'Answer', props: answerProps(report, title, labels) },
    };
    const chart = chartProps(report.chart, report, title, labels);
    if (chart) {
        elements.chart = { type: 'Chart', props: chart };
    }
    const views = visualizations(report, title, labels);
    if (views) {
        elements.views = views;
    }
    elements.breakdown = {
        type: 'BreakdownTable',
        props: {
            label: t('breakdown_label', lang),
            months: report.months,
            columns: {
                name: t('breakdown_column_name', lang),
                amount: t('breakdown_column_amount', lang),
                share: t('breakdown_column_share', lang),
                change: t('breakdown_column_change', lang),
                trend: t('breakdown_column_trend', lang),
            },
            expandLabel: t('breakdown_expand', lang),
            collapseLabel: t('breakdown_collapse', lang),
            emptyLabel: t('breakdown_empty', lang),
            rows: report.breakdown.map(row => breakdownRow(row, labels)),
            ...(report.net
                ? {
                      total: {
                          label: title,
                          color: report.root.color,
                          ...amounts(report.answer),
                          months: report.net.months,
                      },
                  }
                : {}),
        },
        on: { expand: { action: 'expandRow' } },
    };
    elements.source = {
        type: 'Source',
        props: {
            footer: fill('source_footer', lang, { book: report.book.name }),
            period: report.nature === 'position' ? subtitle : labels.dates(report),
            query: report.query,
            url: report.url,
            dataAt: report.dataAt,
            labels: {
                source: t('source_label', lang),
                period: t('source_period', lang),
                query: t('source_query', lang),
                dataAt: t('source_data_at', lang),
                open: t('source_open_in_bkper', lang),
            },
        },
        on: { open: { action: 'openInBkper', params: { url: report.url } } },
    };

    const spec: ReportSpec = {
        root: 'report',
        elements: {
            report: {
                type: 'Report',
                props: {
                    title,
                    subtitle,
                    locale: lang,
                    dir: textDirection(lang),
                    fractionDigits: report.book.fractionDigits ?? 2,
                },
                children: Object.keys(elements),
            },
            ...elements,
        },
    };
    const validation = validateReportSpec(spec);
    if (!validation.valid) {
        throw new Error(`Invalid report spec: ${validation.issues.join('; ')}`);
    }
    return validation.spec;
}

function answerProps(
    report: ReportData,
    title: string,
    labels: Labels
): Extract<ReportElement, { type: 'Answer' }>['props'] {
    const comparison = report.previous && labels.previous(report, report.previous);
    return {
        label: title,
        color: report.root.color,
        ...amounts(report.answer),
        ...(comparison
            ? { comparison: fill('answer_compared_with', labels.lang, { period: comparison }) }
            : {}),
        ...(report.net
            ? {
                  parts: [
                      {
                          id: 'incoming',
                          label: labels.row('incoming'),
                          color: TYPE_COLORS.INCOMING,
                          ...amounts(report.net.incoming),
                      },
                      {
                          id: 'outgoing',
                          label: labels.row('outgoing'),
                          color: TYPE_COLORS.OUTGOING,
                          ...amounts(report.net.outgoing),
                      },
                  ],
              }
            : {}),
    };
}

type ChartProps = Extract<ReportElement, { type: 'Chart' }>['props'];

/**
 * Every other chart that fits the report, with its data, and the preferred one that does not
 * fit with why; left out when the report fits no chart but its main one and nothing was asked.
 */
function visualizations(
    report: ReportData,
    title: string,
    labels: Labels
): Extract<ReportElement, { type: 'Visualizations' }> | undefined {
    const { views, main, unfit } = report.charts;
    if (views.length < 2 && !unfit) {
        return undefined;
    }
    const lang = labels.lang;
    return {
        type: 'Visualizations',
        props: {
            label: t('charts_label', lang),
            main,
            views: views.map(view => {
                const kind = viewKindOf(view);
                const chart = kind === main ? undefined : chartProps(view, report, title, labels);
                return { kind, name: t(VIEW_NAMES[kind], lang), ...(chart ? { chart } : {}) };
            }),
            ...(unfit
                ? {
                      unfit: {
                          kind: unfit.kind,
                          name: t(VIEW_NAMES[unfit.kind], lang),
                          reason: unfitReason(unfit.kind, unfit.reason, report, labels),
                      },
                  }
                : {}),
        },
        on: { select: { action: 'selectChart' } },
    };
}

/** Why a chart does not fit, naming the part and its amount where one is the reason. */
function unfitReason(
    kind: ViewKind,
    reason: UnfitReason,
    report: ReportData,
    labels: Labels
): string {
    if (reason.code === 'negative_part') {
        const row = breakdownRowOf(report, reason.rowId);
        return fill(UNFIT_REASONS.negative_part, labels.lang, {
            name: labels.row(row.kind, row.name),
            amount: labels.amount(row.amount, report.book.fractionDigits ?? 2),
        });
    }
    if (reason.code === 'net_result' && kind === 'stacked') {
        return t('chart_unfit_stacked_net_result', labels.lang);
    }
    return t(UNFIT_REASONS[reason.code], labels.lang);
}

function chartProps(
    chart: ReportChart,
    report: ReportData,
    title: string,
    labels: Labels
): ChartProps | undefined {
    const lang = labels.lang;
    switch (chart.kind) {
        case 'none':
            return undefined;
        case 'bar':
        case 'line':
        case 'area':
        case 'stacked':
            return {
                kind: chart.kind,
                label: fill('chart_by_month', lang, { name: title }),
                months: report.months,
                series: chart.series.map(series => chartSeries(series, title, labels)),
            };
        case 'ranked-bar':
        case 'donut':
        case 'pie':
            return {
                kind: chart.kind,
                label: fill('chart_breakdown', lang, { name: title }),
                items: chart.rows.map(id => {
                    const row = breakdownRowOf(report, id);
                    return {
                        rowId: row.id,
                        label: labels.row(row.kind, row.name),
                        color: row.color,
                        value: row.amount,
                    };
                }),
            };
        case 'compare': {
            const previous = report.previous;
            if (!previous) {
                throw new Error('A comparison without a previous period');
            }
            return {
                kind: 'compare',
                label: fill('chart_breakdown', lang, { name: title }),
                // Both by their dates, so they read alike: never `Last month` against
                // `September 2026`.
                periods: {
                    current: labels.dated(report),
                    previous:
                        report.nature === 'position'
                            ? labels.asOf(previous.before)
                            : labels.previous(report, previous),
                },
                items: chart.rows.map(id => {
                    const row = breakdownRowOf(report, id);
                    return {
                        rowId: row.id,
                        label: labels.row(row.kind, row.name),
                        color: row.color,
                        value: row.amount,
                        previous: row.previous ?? '0',
                    };
                }),
            };
        }
        case 'waterfall': {
            const net = report.root.id === NET_RESULT_ROOT;
            // Incoming to the net result, or the previous position to the position.
            const start = net
                ? labels.row('incoming')
                : report.previous && labels.asOf(report.previous.before);
            if (start === undefined) {
                throw new Error('A bridge of a position without a previous one');
            }
            return {
                kind: 'waterfall',
                label: fill('chart_breakdown', lang, { name: title }),
                start: {
                    label: start,
                    color: net ? TYPE_COLORS.INCOMING : report.root.color,
                    value: chart.start,
                },
                steps: chart.steps.map(step => waterfallStep(step, labels)),
                end: {
                    label: net ? title : labels.period(report),
                    color: report.root.color,
                    value: chart.end,
                },
            };
        }
    }
}

function breakdownRowOf(report: ReportData, id: string): ReportRow {
    const row = report.breakdown.find(candidate => candidate.id === id);
    if (!row) {
        throw new Error(`The chart shows a row the breakdown lacks: ${id}`);
    }
    return row;
}

function waterfallStep(step: WaterfallStep, labels: Labels) {
    return {
        ...(step.id === OTHER_PART ? {} : { rowId: step.id }),
        label: labels.row(step.kind, step.name),
        color: step.color,
        value: step.amount,
    };
}

/**
 * A series of the root or a breakdown row, by its name; of a side of the net result; of the
 * net result itself; or of the rest of the rows (`other`).
 */
function chartSeries(series: ChartSeries, title: string, labels: Labels) {
    const named = ['incoming', 'outgoing', OTHER_PART] as const;
    const kind = named.find(id => id === series.id) ?? 'group';
    return {
        id: series.id,
        label: series.id === NET_RESULT_ROOT ? title : labels.row(kind, series.name),
        color: series.color,
        ...(series.line ? { line: series.line } : {}),
        values: series.amounts,
    };
}

function breakdownRow(row: ReportRow, labels: Labels): BreakdownRow {
    return {
        id: row.id,
        kind: row.kind,
        label: labels.row(row.kind, row.name),
        color: row.color,
        ...amounts(row),
        ...(row.share === undefined ? {} : { share: row.share }),
        months: row.months,
        children: row.children.map(child => breakdownRow(child, labels)),
    };
}

function amounts(source: ReportAmounts): ReportAmounts {
    return {
        amount: source.amount,
        ...(source.previous === undefined ? {} : { previous: source.previous }),
        ...(source.change === undefined ? {} : { change: source.change }),
    };
}

/**
 * The text of a key with values written into it, each isolated: a Latin name or a date keeps
 * its place in a right-to-left sentence, and an Arabic name in a left-to-right one.
 */
function fill(key: StringKey, lang: string, params: Record<string, string>): string {
    return t(
        key,
        lang,
        Object.fromEntries(Object.entries(params).map(([name, value]) => [name, isolate(value)]))
    );
}

/**
 * Labels of rows, periods and dates in one language, with its own digits and date formats;
 * dates are calendar dates, read in UTC.
 */
class Labels {
    private readonly day: Intl.DateTimeFormat;
    private readonly number: Intl.NumberFormat;

    constructor(readonly lang: string) {
        this.day = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
        this.number = new Intl.NumberFormat(lang);
    }

    row(kind: RowKind, name?: string): string {
        if (name !== undefined) {
            return name;
        }
        if (kind === 'group' || kind === 'account') {
            throw new Error(`A ${kind} row without a name`);
        }
        return t(NAMED_ROWS[kind], this.lang);
    }

    /** The period of an activity, by its name; the date of a position. */
    period(report: ReportData): string {
        if (report.nature === 'position') {
            return this.asOf(report.period.before);
        }
        const relative = relativePeriodLabel(report.period.id);
        return relative ? t(relative, this.lang) : this.range(report.period);
    }

    /** The period of an activity by its dates or calendar name, never relative; the date of a position. */
    dated(report: ReportData): string {
        return report.nature === 'position'
            ? this.asOf(report.period.before)
            : this.range(report.period);
    }

    /** What a report compares with: an earlier date for a position, else a period. */
    previous(report: ReportData, previous: DateRange): string {
        return report.nature === 'position'
            ? this.date(lastDay(previous.before))
            : this.range(previous);
    }

    /** The exact dates an activity covers; all time starts with the first month of data. */
    dates(report: ReportData): string {
        const after = report.period.after ?? (report.months[0] && `${report.months[0]}-01`);
        const last = lastDay(report.period.before);
        return after
            ? this.day.formatRange(utc(after), utc(last))
            : this.asOf(report.period.before);
    }

    /** A whole year, quarter or month by its name; any other range by its dates. */
    private range(range: DateRange): string {
        const { after, before } = range;
        if (after === undefined) {
            return this.asOf(before);
        }
        const [, month, day] = after.split('-').map(Number);
        const months = monthsBetween(after, before);
        if (day === 1 && month === 1 && months === 12) {
            return this.format(after, { year: 'numeric' });
        }
        if (day === 1 && month % 3 === 1 && months === 3) {
            return fill('period_quarter', this.lang, {
                quarter: this.number.format((month + 2) / 3),
                year: this.format(after, { year: 'numeric' }),
            });
        }
        if (day === 1 && months === 1) {
            return this.format(after, { month: 'long', year: 'numeric' });
        }
        return this.day.formatRange(utc(after), utc(lastDay(before)));
    }

    /** An amount with the Book's decimal places, exactly, in the language's digits. */
    amount(value: string, fractionDigits: number): string {
        if (!isDecimal(value)) {
            throw new Error(`Expected a decimal string: ${value}`);
        }
        return new Intl.NumberFormat(this.lang, {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(value);
    }

    /** The date of a position at the start of `before`. */
    asOf(before: IsoDate): string {
        return fill('position_as_of', this.lang, { date: this.date(lastDay(before)) });
    }

    private date(date: IsoDate): string {
        return this.day.format(utc(date));
    }

    private format(date: IsoDate, options: Intl.DateTimeFormatOptions): string {
        return new Intl.DateTimeFormat(this.lang, { ...options, timeZone: 'UTC' }).format(
            utc(date)
        );
    }
}

/** Intl formats a decimal string exactly, never through a binary float. */
function isDecimal(value: string): value is `${number}` {
    return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
}

/** Whole months from `after` to `before` when both are first days of a month, else 0. */
function monthsBetween(after: IsoDate, before: IsoDate): number {
    if (!after.endsWith('-01') || !before.endsWith('-01')) {
        return 0;
    }
    const [afterYear, afterMonth] = after.split('-').map(Number);
    const [beforeYear, beforeMonth] = before.split('-').map(Number);
    return (beforeYear - afterYear) * 12 + beforeMonth - afterMonth;
}

/** The last day a range ending at `before` (exclusive) includes. */
function lastDay(before: IsoDate): IsoDate {
    return addDays(before, -1);
}

function utc(date: IsoDate): Date {
    return new Date(`${date}T00:00:00Z`);
}
