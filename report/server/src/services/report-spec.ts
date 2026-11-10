/**
 * Report spec: the data of a report becomes a json-render spec of the report catalog, in one
 * language.
 *
 * Every text is resolved here, in the report's language: titles, period labels, the note on
 * a net result Report calculates, and the labels renderers show. Group and account names stay
 * verbatim. Amounts and ratios stay the report's decimal strings, and
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
import type { ReadDays } from './bkper-dates.js';
import { addDays, type IsoDate } from './periods.js';
import type { PeriodSpan } from './period-query.js';
import { NET_RESULT_ROOT } from './report-intent.js';
import { requestText } from './request-text.js';
import {
    viewKindOf,
    type ChartSeries,
    type ReportAmounts,
    type ReportChart,
    type ReportData,
    type ReportRow,
    type UnfitReason,
} from './report.js';

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
    not_a_whole: 'chart_unfit_not_a_whole',
    no_bridge: 'chart_unfit_no_bridge',
    side_by_side: 'chart_unfit_side_by_side',
    // Said of the chart it is about.
    net_result: 'chart_unfit_pie_net_result',
} as const satisfies Record<UnfitReason['code'], StringKey>;

/** Reasons said in the words of stacked bars rather than of a pie. */
const STACKED_UNFIT_REASONS = {
    net_result: 'chart_unfit_stacked_net_result',
    mixed_parts: 'chart_unfit_stacked_mixed_parts',
    too_many_parts: 'chart_unfit_stacked_too_many_parts',
} as const satisfies Partial<Record<UnfitReason['code'], StringKey>>;

/** The spec of a report in a language; it always passes the catalog's validation. */
export function buildReportSpec(report: ReportData, lang: string): ReportSpec {
    const labels = new Labels(lang);
    const title = reportTitle(report, lang);
    const subtitle = labels.period(report);
    // Targets side by side have an Answer each, in order, and none for them together.
    const elements: Record<string, ReportElement> = report.targets
        ? Object.fromEntries(
              report.targets.map((row, index) => [
                  `answer-${index + 1}`,
                  { type: 'Answer', props: answerProps(report, row, labels) },
              ])
          )
        : {
              answer: {
                  type: 'Answer',
                  props: answerProps(report, { ...report.root, ...report.answer }, labels),
              },
          };
    const chart = chartProps(report.chart, report, title, labels);
    if (chart) {
        elements.chart = { type: 'Chart', props: chart };
    }
    const views = visualizations(report, title, labels);
    if (views) {
        elements.views = views;
    }
    // An account has no parts: a table of them would only say it has none.
    if (!report.account) {
        elements.breakdown = breakdownTable(report, title, lang);
    }
    elements.source = {
        type: 'Source',
        props: {
            footer: fill('source_footer', lang, { book: report.book.name }),
            period: report.nature === 'position' ? subtitle : labels.dates(report),
            query: report.query,
            url: report.url,
            dataAt: report.dataAt,
            ...(report.calculated
                ? {
                      calculated: {
                          label: t('source_calculated', lang),
                          note: t('source_calculated_note', lang),
                      },
                  }
                : {}),
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
                    request: requestText(report.intent, title, lang),
                    ...(report.comparisonError ? { notice: comparisonNotice(report, labels) } : {}),
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

/**
 * Why the report does not compare with the period asked for, and what it compares with
 * instead: the previous period, or nothing for all time.
 */
function comparisonNotice(report: ReportData, labels: Labels): string {
    return report.previous
        ? fill('notice_comparison_fallback', labels.lang, {
              period: labels.previous(report, report.previous),
          })
        : t('notice_comparison_none', labels.lang);
}

/**
 * The title of a report: the name of what it is of, or the names of its targets side by side
 * as a list, each isolated, so names of either direction keep their order.
 */
function reportTitle(report: ReportData, lang: string): string {
    if (report.targets) {
        return new Intl.ListFormat(lang, { type: 'conjunction' }).format(
            report.targets.map(row => isolate(row.name))
        );
    }
    return report.root.name ?? t('report_net_result', lang);
}

/**
 * The table of the rows Bkper returns under the report's group, nested; of targets side by
 * side, the targets, each with the rows under it.
 */
function breakdownTable(
    report: ReportData,
    title: string,
    lang: string
): Extract<ReportElement, { type: 'BreakdownTable' }> {
    return {
        type: 'BreakdownTable',
        props: {
            label: report.targets
                ? fill('chart_side_by_side', lang, { names: title })
                : t('breakdown_label', lang),
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
            rows: report.breakdown.map(row => breakdownRow(row)),
            // A net result Report calculates totals its roots, which are the rows.
            ...(report.calculated && report.root
                ? {
                      total: {
                          label: title,
                          color: report.root.color,
                          ...amounts(report.answer),
                          months: report.calculated.months,
                      },
                  }
                : {}),
        },
        on: { expand: { action: 'expandRow' } },
    };
}

/** The Answer of what a report is of, or of one of its targets side by side. */
function answerProps(
    report: ReportData,
    subject: ReportAmounts & { name?: string; color: ReportRow['color'] },
    labels: Labels
): Extract<ReportElement, { type: 'Answer' }>['props'] {
    const comparison = report.previous && labels.previous(report, report.previous);
    return {
        label: subject.name ?? t('report_net_result', labels.lang),
        color: subject.color,
        ...amounts(subject),
        ...(comparison
            ? { comparison: fill('answer_compared_with', labels.lang, { period: comparison }) }
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
            name: row.name,
            amount: labels.amount(row.amount, report.book.fractionDigits ?? 2),
        });
    }
    const stacked =
        kind === 'stacked'
            ? Object.entries(STACKED_UNFIT_REASONS).find(([code]) => code === reason.code)?.[1]
            : undefined;
    return t(stacked ?? UNFIT_REASONS[reason.code], labels.lang);
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
                series: chart.series.map(series => chartSeries(series, title)),
            };
        case 'ranked-bar':
        case 'donut':
        case 'pie':
            return {
                kind: chart.kind,
                label: itemsLabel(report, title, lang),
                items: chart.rows.map(id => {
                    const row = breakdownRowOf(report, id);
                    return {
                        rowId: row.id,
                        label: row.name,
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
                label: itemsLabel(report, title, lang),
                // Both by the months each read, in the same form.
                periods: {
                    current: labels.period(report),
                    previous:
                        report.nature === 'position'
                            ? labels.asOf(previous.before)
                            : labels.previous(report, previous),
                },
                items: chart.rows.map(id => {
                    const row = breakdownRowOf(report, id);
                    return {
                        rowId: row.id,
                        label: row.name,
                        color: row.color,
                        value: row.amount,
                        previous: row.previous ?? '0',
                    };
                }),
            };
        }
    }
}

/** The label of a chart of the parts, or of targets side by side, which are no parts of one whole. */
function itemsLabel(report: ReportData, title: string, lang: string): string {
    return report.targets
        ? fill('chart_side_by_side', lang, { names: title })
        : fill('chart_breakdown', lang, { name: title });
}

function breakdownRowOf(report: ReportData, id: string): ReportRow {
    const row = report.breakdown.find(candidate => candidate.id === id);
    if (!row) {
        throw new Error(`The chart shows a row the breakdown lacks: ${id}`);
    }
    return row;
}

/** A series of the root or a breakdown row, by its name, or of a net result Report calculates. */
function chartSeries(series: ChartSeries, title: string) {
    return {
        id: series.id,
        label: series.id === NET_RESULT_ROOT || series.name === undefined ? title : series.name,
        color: series.color,
        ...(series.line ? { line: series.line } : {}),
        values: series.amounts,
    };
}

function breakdownRow(row: ReportRow): BreakdownRow {
    return {
        id: row.id,
        kind: row.kind,
        label: row.name,
        color: row.color,
        ...amounts(row),
        ...(row.share === undefined ? {} : { share: row.share }),
        months: row.months,
        children: row.children.map(breakdownRow),
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
    private readonly monthRange: Intl.DateTimeFormat;
    private readonly number: Intl.NumberFormat;
    /** A year's digits alone: a quarter's label writes its own words around them. */
    private readonly digits: Intl.NumberFormat;

    constructor(readonly lang: string) {
        this.day = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
        this.monthRange = new Intl.DateTimeFormat(lang, {
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
        });
        this.number = new Intl.NumberFormat(lang);
        this.digits = new Intl.NumberFormat(lang, { useGrouping: false });
    }

    /**
     * The months an activity read, by the days Bkper read (all time by its name), in the form
     * of the period asked for ({@link form}); the date of a position.
     */
    period(report: ReportData): string {
        if (report.nature === 'position') {
            return this.asOf(report.period.before);
        }
        return report.period.after === undefined
            ? t('period_all', this.lang)
            : this.months(report.period.after, report.period.before, this.form(report));
    }

    /**
     * What a report compares with: an earlier date for a position, else the months read, in the
     * same form as the period.
     */
    previous(report: ReportData, previous: ReadDays): string {
        return report.nature === 'position' || previous.after === undefined
            ? this.date(lastDay(previous.before))
            : this.months(previous.after, previous.before, this.form(report));
    }

    /** The exact dates an activity covers; all time starts with the first month of data. */
    dates(report: ReportData): string {
        const after = report.period.after ?? (report.months[0] && `${report.months[0]}-01`);
        const last = lastDay(report.period.before);
        return after
            ? this.day.formatRange(utc(after), utc(last))
            : this.asOf(report.period.before);
    }

    /**
     * How both sides of a comparison are named: by the name of the kind of period asked for when
     * each reads one whole (a year, a quarter or a month), else by their range of months, as a
     * running period, which reads only the months so far (this year in March is Jan – Mar).
     */
    private form(report: ReportData): MonthsForm {
        const sides = [report.period, ...(report.previous ? [report.previous] : [])];
        const whole = WHOLE_FORMS[report.period.kind];
        return whole && sides.every(side => side.after && fits(whole, side.after, side.before))
            ? whole
            : 'range';
    }

    /**
     * Whole months in a form: a year (`2025`), a quarter (`Q3 2024`), a month (`January 2025`),
     * or a range of months (`Jan – Nov 2026`); days that are no whole months by their dates.
     */
    private months(after: IsoDate, before: IsoDate, form: MonthsForm): string {
        const months = monthsBetween(after, before);
        if (months === 0) {
            return this.day.formatRange(utc(after), utc(lastDay(before)));
        }
        switch (form) {
            case 'year':
                return this.format(after, { year: 'numeric' });
            case 'quarter':
                return fill('period_quarter', this.lang, {
                    quarter: this.number.format((Number(after.slice(5, 7)) + 2) / 3),
                    year: this.digits.format(Number(after.slice(0, 4))),
                });
            case 'month':
                return this.format(after, { month: 'long', year: 'numeric' });
            case 'range':
                return this.monthRange.formatRange(utc(after), utc(lastDay(before)));
        }
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

/** How whole months are named: by a calendar period's name, or as a range of months. */
type MonthsForm = 'year' | 'quarter' | 'month' | 'range';

/** The name a whole period of each kind has; the others are ranges of months. */
const WHOLE_FORMS: Partial<Record<PeriodSpan, MonthsForm>> = {
    year: 'year',
    year_to_date: 'year',
    quarter: 'quarter',
    month: 'month',
    now: 'month',
};

/** Whether the months from `after` to `before` are one whole period of a form. */
function fits(form: MonthsForm, after: IsoDate, before: IsoDate): boolean {
    const months = monthsBetween(after, before);
    const month = Number(after.slice(5, 7));
    switch (form) {
        case 'year':
            return months === 12 && month === 1;
        case 'quarter':
            return months === 3 && month % 3 === 1;
        case 'month':
            return months === 1;
        case 'range':
            return months > 0;
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
