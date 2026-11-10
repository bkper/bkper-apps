/**
 * The values a report intent may hold, shared by the Worker that validates intents and the
 * places that write them down, such as a report's compact state (`report-state.ts`).
 */

/** The `root` of a net result report: every Incoming root versus every Outgoing root. */
export const NET_RESULT_ROOT = 'net-result';

/** The longest root or target id an intent accepts. */
export const MAX_ROOT_LENGTH = 200;

/** The most groups or accounts a report shows alongside its first, side by side. */
export const MAX_ALONGSIDE = 5;

export const REPORT_VIEWS = ['trend', 'breakdown', 'total'] as const;

export type ReportView = (typeof REPORT_VIEWS)[number];

/**
 * The chart a person may prefer: any chart a report can show. `auto` (or none) leaves it to
 * the rules; any other is drawn when it fits the report, else the closest chart that fits.
 * `bar` and `line` are by month; `table` draws no chart.
 */
export const REPORT_CHARTS = [
    'auto',
    'pie',
    'stacked',
    'area',
    'compare',
    'waterfall',
    'table',
    'bar',
    'line',
    'ranked-bar',
    'donut',
] as const;

export type ChartPreference = (typeof REPORT_CHARTS)[number];

/**
 * A hashtag name without `#`. It goes into a Bkper query verbatim, so it excludes whitespace,
 * quotes and the separators Bkper splits hashtags on.
 */
export const HASHTAG_PATTERN = /^[^\s#,.'"]+$/;

/**
 * The most hashtags an intent accepts, and the longest of them. Bkper's balances filter by a
 * hashtag only when a query has exactly one; with more, they ignore them all.
 */
export const MAX_HASHTAGS = 1;
export const MAX_HASHTAG_LENGTH = 100;

/**
 * What a report compares its period with: the period right before it (the default), or the same
 * period a year earlier, such as January last year for January.
 */
export const COMPARE_WITH = ['previous', 'year_earlier'] as const;

export type CompareWith = (typeof COMPARE_WITH)[number];

export const RELATIVE_PERIODS = [
    'today',
    'this_month',
    'last_month',
    'this_quarter',
    'last_quarter',
    'this_year',
    'last_year',
    'ytd',
    'last_12_months',
    'all',
] as const;

export type RelativePeriod = (typeof RELATIVE_PERIODS)[number];

/**
 * The period ids intents held before they held parts: relative ids, a year `YYYY`, a quarter
 * `YYYY-Qn` or a month `YYYY-MM`. Still accepted, as {@link periodRequestOf} translates them.
 */
export const PERIOD_ID_PATTERN = new RegExp(
    `^(?:${RELATIVE_PERIODS.join('|')}|[12]\\d{3}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?)$`
);

/** The kind of period a request names. */
export const PERIOD_SPANS = [
    'month',
    'quarter',
    'year',
    'year_to_date',
    'last_12_months',
    'all_time',
    'now',
] as const;

export type PeriodSpan = (typeof PERIOD_SPANS)[number];

/** Years relative to today's. */
export const RELATIVE_YEARS = ['current', 'previous', 'before_previous'] as const;

export type RelativeYear = (typeof RELATIVE_YEARS)[number];

/** The years a period may write: the years a Book's dates can plausibly hold. */
export const MIN_YEAR = 1000;
export const MAX_YEAR = 2999;

/** A year relative to today's, or a year written in the request, such as `2023`. */
export type YearPart = RelativeYear | number;

/** A month or quarter relative to today's. */
export const RELATIVE_UNITS = ['current', 'previous'] as const;

export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

export const MONTHS_OF_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** January is 1. */
export type MonthOfYear = (typeof MONTHS_OF_YEAR)[number];

/** A named month, or the current or previous month. */
export type MonthPart = MonthOfYear | RelativeUnit;

export const QUARTERS_OF_YEAR = [1, 2, 3, 4] as const;

export type QuarterOfYear = (typeof QUARTERS_OF_YEAR)[number];

/** A named quarter, or the current or previous quarter. */
export type QuarterPart = QuarterOfYear | RelativeUnit;

/** The parts of the period compared with; those left out are the period's own. */
export interface ComparedParts {
    year?: YearPart;
    month?: MonthPart;
    quarter?: QuarterPart;
}

/**
 * The parts of a period as a request says them; a part left out is unspecified. Relative words
 * stay relative (`year: 'previous'`) and written years stay fixed (`year: 2023`), so a period
 * kept as parts keeps its meaning. Without a span, the period is a month when a month is named,
 * else a quarter when one is, else a year.
 */
export interface PeriodParts extends ComparedParts {
    span?: PeriodSpan;
}

/** A period, and what it is compared with. */
export interface PeriodRequest {
    period: PeriodParts;
    /** Given, the period compared with; else the default comparison of {@link compareWith}. */
    compared?: ComparedParts;
    /** Without compared parts: the previous period (the default), or the same months a year earlier. */
    compareWith?: CompareWith;
}

const RELATIVE_ID_PARTS: Record<RelativePeriod, PeriodParts> = {
    today: { span: 'now' },
    this_month: { span: 'month', month: 'current' },
    last_month: { span: 'month', month: 'previous' },
    this_quarter: { span: 'quarter', quarter: 'current' },
    last_quarter: { span: 'quarter', quarter: 'previous' },
    this_year: { span: 'year', year: 'current' },
    last_year: { span: 'year', year: 'previous' },
    ytd: { span: 'year_to_date' },
    last_12_months: { span: 'last_12_months' },
    all: { span: 'all_time' },
};

/**
 * The parts of a period id (see {@link PERIOD_ID_PATTERN}) and what it is compared with, or
 * `undefined` for anything else. Relative ids stay relative; dated ids are fixed. All time had
 * no comparison, so it keeps none.
 */
export function periodRequestOf(id: string, compareWith?: CompareWith): PeriodRequest | undefined {
    if (!PERIOD_ID_PATTERN.test(id)) {
        return undefined;
    }
    const relative = (RELATIVE_PERIODS as readonly string[]).includes(id)
        ? RELATIVE_ID_PARTS[id as RelativePeriod]
        : undefined;
    const period = relative ? { ...relative } : datedParts(id);
    return compareWith === 'year_earlier' && id !== 'all' ? { period, compareWith } : { period };
}

function datedParts(id: string): PeriodParts {
    const [yearText, rest] = id.split('-');
    const year = Number(yearText);
    if (rest === undefined) {
        return { span: 'year', year };
    }
    if (rest.startsWith('Q')) {
        return { span: 'quarter', year, quarter: Number(rest.slice(1)) as QuarterOfYear };
    }
    return { span: 'month', year, month: Number(rest) as MonthOfYear };
}

/**
 * The period id whose parts are exactly these, with no compared parts, or `undefined` when no
 * id says them: the inverse of {@link periodRequestOf}.
 */
export function periodIdOf(request: PeriodRequest): string | undefined {
    if (request.compared !== undefined) {
        return undefined;
    }
    const { span, year, month, quarter } = request.period;
    const id =
        typeof year === 'number'
            ? `${year}${
                  span === 'quarter' ? `-Q${quarter}` : span === 'month' ? `-${pad(month)}` : ''
              }`
            : RELATIVE_PERIODS.find(id => samePeriodParts(RELATIVE_ID_PARTS[id], request.period));
    const translated = id === undefined ? undefined : periodRequestOf(id, request.compareWith);
    return translated &&
        samePeriodParts(translated.period, request.period) &&
        translated.compareWith ===
            (request.compareWith === 'year_earlier' ? 'year_earlier' : undefined)
        ? id
        : undefined;
}

function pad(value: unknown): string {
    return String(value).padStart(2, '0');
}

/** Whether two periods name the same parts. */
export function samePeriodParts(a: PeriodParts, b: PeriodParts): boolean {
    return a.span === b.span && a.year === b.year && a.month === b.month && a.quarter === b.quarter;
}

/** Whether parts name a period, each part valid; a period names at least one part. */
export function validPeriodParts(parts: PeriodParts): boolean {
    return (
        (parts.span === undefined || (PERIOD_SPANS as readonly string[]).includes(parts.span)) &&
        validComparedParts(parts, parts.span !== undefined)
    );
}

/** Whether compared parts name a period, each part valid; they name at least one part. */
export function validComparedParts(parts: ComparedParts, named = false): boolean {
    const { year, month, quarter } = parts;
    return (
        (named || year !== undefined || month !== undefined || quarter !== undefined) &&
        (year === undefined ||
            (RELATIVE_YEARS as readonly unknown[]).includes(year) ||
            (Number.isInteger(year) && Number(year) >= MIN_YEAR && Number(year) <= MAX_YEAR)) &&
        (month === undefined ||
            (RELATIVE_UNITS as readonly unknown[]).includes(month) ||
            (MONTHS_OF_YEAR as readonly unknown[]).includes(month)) &&
        (quarter === undefined ||
            (RELATIVE_UNITS as readonly unknown[]).includes(quarter) ||
            (QUARTERS_OF_YEAR as readonly unknown[]).includes(quarter))
    );
}

/** A group or account a report is of: a root group or an account in no group, or a target under a root group. */
export interface ReportSubjectData {
    /** Root group id, or the id of an account in no group. */
    root: string;
    /** A group or account under the root group to report instead of the whole root. */
    target?: string;
}

/** What to report, fully resolved, as plain data. */
export interface ReportIntentData {
    /** Root group id, the id of an account in no group, or {@link NET_RESULT_ROOT}. */
    root: string;
    /** A group or account under the root group to report instead of the whole root. */
    target?: string;
    /**
     * More groups or accounts to show side by side with the first (`root`, `target`), each
     * with its own amount, in order; never added up.
     */
    alongside?: ReportSubjectData[];
    /** The period, as its parts. */
    period: PeriodParts;
    /** The period compared with, as its parts; those left out are the period's own. */
    compared?: ComparedParts;
    monthly: boolean;
    /** Without `compared`, what the period is compared with; left out, `previous`. */
    compareWith?: CompareWith;
    view?: ReportView;
    chart?: ChartPreference;
    hashtags?: string[];
}

/** An intent as callers may still send it: its period as parts, or as the id of older intents. */
export type ReportIntentInputData = Omit<ReportIntentData, 'period'> & {
    period: PeriodParts | string;
};

/**
 * An intent with its period as parts: a period id of older intents, with its `compareWith`,
 * translated by {@link periodRequestOf}; `undefined` for an id that is none.
 */
export function intentWithParts<
    T extends { period: PeriodParts | string; compareWith?: CompareWith },
>(
    intent: T
):
    | (Omit<T, 'period' | 'compareWith'> & { period: PeriodParts; compareWith?: CompareWith })
    | undefined {
    const { period, compareWith, ...rest } = intent;
    if (typeof period !== 'string') {
        return { ...rest, period, ...(compareWith === undefined ? {} : { compareWith }) };
    }
    const request = periodRequestOf(period, compareWith);
    return (
        request && {
            ...rest,
            period: request.period,
            ...(request.compareWith ? { compareWith: request.compareWith } : {}),
        }
    );
}
