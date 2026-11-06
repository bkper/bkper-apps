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
} from 'report-shared/catalog';
import { t, textDirection, type StringKey } from 'report-shared/strings';
import { addDays, type DateRange, type IsoDate, type RelativePeriod } from './periods.js';
import { NET_RESULT_ROOT } from './report-intent.js';
import {
    TYPE_COLORS,
    type ChartSeries,
    type ReportAmounts,
    type ReportData,
    type ReportRow,
    type RowKind,
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
    const chart = chartElement(report, title, labels);
    if (chart) {
        elements.chart = chart;
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
            footer: t('source_footer', lang, { book: report.book.name }),
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
            ? { comparison: t('answer_compared_with', labels.lang, { period: comparison }) }
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

function chartElement(
    report: ReportData,
    title: string,
    labels: Labels
): Extract<ReportElement, { type: 'Chart' }> | undefined {
    const { chart } = report;
    const lang = labels.lang;
    switch (chart.kind) {
        case 'none':
            return undefined;
        case 'bar':
        case 'line':
            return {
                type: 'Chart',
                props: {
                    kind: chart.kind,
                    label: t('chart_by_month', lang, { name: title }),
                    months: report.months,
                    series: chart.series.map(series => chartSeries(series, title, labels)),
                },
            };
        case 'ranked-bar':
        case 'donut':
            return {
                type: 'Chart',
                props: {
                    kind: chart.kind,
                    label: t('chart_breakdown', lang, { name: title }),
                    items: chart.rows.map(id => {
                        const row = report.breakdown.find(candidate => candidate.id === id);
                        if (!row) {
                            throw new Error(`The chart shows a row the breakdown lacks: ${id}`);
                        }
                        return {
                            rowId: row.id,
                            label: labels.row(row.kind, row.name),
                            color: row.color,
                            value: row.amount,
                        };
                    }),
                },
            };
    }
}

/** A series of the root, by its name, or of a side of the net result, or the net result itself. */
function chartSeries(series: ChartSeries, title: string, labels: Labels) {
    const kind = series.id === 'incoming' || series.id === 'outgoing' ? series.id : 'group';
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

/** Labels of rows, periods and dates in one language; dates are calendar dates, read in UTC. */
class Labels {
    private readonly day: Intl.DateTimeFormat;

    constructor(readonly lang: string) {
        this.day = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
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
            return t('period_quarter', this.lang, {
                quarter: String((month + 2) / 3),
                year: this.format(after, { year: 'numeric' }),
            });
        }
        if (day === 1 && months === 1) {
            return this.format(after, { month: 'long', year: 'numeric' });
        }
        return this.day.formatRange(utc(after), utc(lastDay(before)));
    }

    private asOf(before: IsoDate): string {
        return t('position_as_of', this.lang, { date: this.date(lastDay(before)) });
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
