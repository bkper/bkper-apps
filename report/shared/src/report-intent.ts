/**
 * The values a report intent may hold, shared by the Worker that validates intents and the
 * places that write them down, such as a report's compact state (`report-state.ts`).
 */

/** The `root` of a net result report: every Incoming root versus every Outgoing root. */
export const NET_RESULT_ROOT = 'net-result';

/** The longest root group id an intent accepts. */
export const MAX_ROOT_LENGTH = 200;

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

/** The most hashtags an intent accepts, and the longest of them. */
export const MAX_HASHTAGS = 10;
export const MAX_HASHTAG_LENGTH = 100;

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

/** Relative ids, a year `YYYY`, a quarter `YYYY-Qn` or a month `YYYY-MM`. */
export const PERIOD_ID_PATTERN = new RegExp(
    `^(?:${RELATIVE_PERIODS.join('|')}|[12]\\d{3}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?)$`
);

/** What to report, fully resolved, as plain data. */
export interface ReportIntentData {
    /** Root group id, or {@link NET_RESULT_ROOT}. */
    root: string;
    /** A period id, see {@link PERIOD_ID_PATTERN}. */
    period: string;
    monthly: boolean;
    view?: ReportView;
    chart?: ChartPreference;
    hashtags?: string[];
}
