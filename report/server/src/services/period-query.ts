/**
 * The dates of a report's Bkper query, built from the parts of a period a request names: its
 * span, year, month and quarter, and those of the period it is compared with. The query is the
 * single source of a report's dates: the same text reads the balances, is shown, and opens in
 * Bkper, and Bkper resolves its dates. Parts are plain data, so they can be stored and the
 * query built again from them, relative words staying relative.
 *
 * Periods are whole months, and every query ends with `by:m`: a full date `yyyy-mm-dd` would make
 * Bkper read by day. The only day is a balance now, or at the end of a running period:
 * `before:$d+1`. Dates are written in two forms only, which every Book date format reads alike:
 *
 * - bare variables (`$y±n`, `$m±n`) for a period relative to today on its own, such as last year
 *   (`on:$y-1`) or the year to date (`after:$y before:$m+1`), which keep their meaning;
 * - ISO `yyyy` or `yyyy-mm` for everything else: written years, named months and quarters, and
 *   the months of a quarter (Bkper has no quarter variable).
 *
 * Never a variable combined with a month (`01/$y-1`: Bkper reads the whole year, or nothing in
 * year-first Books), and never a month offset for a named month (`$m-22` for January last year
 * drifts to another month once the text is kept).
 *
 * A running period (one that contains the current month) is read through the end of the current
 * month, and its comparison covers the same months. A position (Asset, Liability) is read at the
 * end of its period. Bkper's own `previousRange` is not used: it is wrong for mixed ranges.
 */
import type { CompareWith } from 'report-shared/report-intent';
import {
    addDays,
    isPeriodId,
    isPlausibleYear,
    isoMonth,
    type IsoDate,
    type IsoMonth,
    type ReportNature,
} from './periods.js';

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

/** A year relative to today's, or a year written in the request, such as `2023`. */
export type YearPart = RelativeYear | number;

/** January is 1. */
export type MonthOfYear = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** A named month, or the current or previous month. */
export type MonthPart = MonthOfYear | 'current' | 'previous';

export type QuarterOfYear = 1 | 2 | 3 | 4;

/** A named quarter, or the current or previous quarter. */
export type QuarterPart = QuarterOfYear | 'current' | 'previous';

/**
 * The parts of a period a request names; a part left out is unspecified. Without a span, the
 * period is a month when a month is named, else a quarter when one is, else a year.
 */
export interface PeriodParts {
    span?: PeriodSpan;
    year?: YearPart;
    month?: MonthPart;
    quarter?: QuarterPart;
}

/** The parts of the period compared with; those left out are the period's own. */
export interface ComparedParts {
    year?: YearPart;
    month?: MonthPart;
    quarter?: QuarterPart;
}

export interface PeriodRequest {
    period: PeriodParts;
    /** Given, the period compared with; else the default comparison of {@link compareWith}. */
    compared?: ComparedParts;
    /** Without compared parts: the previous period (the default), or the same months a year earlier. */
    compareWith?: CompareWith;
}

/** Why a request has no period to read. */
export type PeriodError =
    /** The request names no period. */
    | 'unspecified_period'
    /** The period starts after the current month. */
    | 'future_period';

/** Why a period has no comparison it asked for; the period itself is read. */
export type ComparisonError =
    /** All time has nothing before it. */
    | 'comparison_unavailable'
    /** The comparison is another kind of period, such as a month for a year. */
    | 'comparison_kind_mismatch'
    /** The comparison does not end before the period starts. */
    | 'comparison_not_earlier';

/** A period as its query reads it. */
export interface PeriodDates {
    /** The date part of the Bkper query, ending with `by:m`. */
    dates: string;
    kind: PeriodSpan;
    /** Contains the current month, so it is read through the end of the current month. */
    running: boolean;
    /** The first month of the period; all time has none. */
    first?: IsoMonth;
    /** The last month of the period; a position is read at its end. */
    last: IsoMonth;
}

export type PeriodQuery =
    | {
          ok: true;
          period: PeriodDates;
          /** The period compared with; all time has none. */
          comparison?: PeriodDates;
          /** Why the comparison asked for cannot be read; never replaced by another. */
          comparisonError?: ComparisonError;
      }
    | { ok: false; reason: PeriodError };

export interface PeriodQueryContext {
    /** The Book's today, `YYYY-MM-DD`, in its time zone. */
    today: IsoDate;
    nature: ReportNature;
}

/** Months are counted as `year * 12 + (month - 1)`, so month arithmetic is integer arithmetic. */
interface Months {
    kind: PeriodSpan;
    first?: number;
    last: number;
    /** Every part is relative to today, so bare variables write it. */
    relative: boolean;
}

/** The parts of a period with every part its span reads. */
interface Normalized {
    span: PeriodSpan;
    year?: YearPart;
    month?: MonthPart;
    quarter?: QuarterPart;
}

/**
 * The dates of a period's query and of its comparison's, or why there is no period. A period
 * that names no year for its month or quarter is this year's, or last year's when it has not
 * started yet. A comparison must be the same kind of period, wholly earlier; one wholly later
 * swaps with the period (a person comparing two periods wants both, and change reads from the
 * earlier to the later), so the later one is read as the period, to this month when running.
 */
export function buildPeriodQuery(request: PeriodRequest, context: PeriodQueryContext): PeriodQuery {
    assertParts(request.period);
    if (request.compared) {
        assertParts(request.compared);
    }
    const current = monthOfDate(context.today);
    const normalized = normalize(request.period);
    if (!normalized) {
        return { ok: false, reason: 'unspecified_period' };
    }
    const whole = resolvePeriod(normalized, current);
    if (whole.first !== undefined && whole.first > current) {
        return { ok: false, reason: 'future_period' };
    }
    let period: Months = { ...whole, last: Math.min(whole.last, current) };
    const write = (months: Months) => periodDates(months, context.nature, current);
    let comparison = compare(normalized, period, request, current);
    if (
        typeof comparison === 'object' &&
        comparison.first !== undefined &&
        comparison.first > period.last
    ) {
        const later = swap(period, comparison, whole.last - (whole.first ?? 0) + 1, current);
        if (!later) {
            return { ok: false, reason: 'future_period' };
        }
        ({ period, comparison } = later);
    }
    return {
        ok: true,
        period: write(period),
        ...(comparison === undefined
            ? {}
            : typeof comparison === 'string'
              ? { comparisonError: comparison }
              : { comparison: write(comparison) }),
    };
}

function normalize(parts: PeriodParts): Normalized | undefined {
    const span =
        parts.span ??
        (parts.month !== undefined
            ? 'month'
            : parts.quarter !== undefined
              ? 'quarter'
              : parts.year !== undefined
                ? 'year'
                : undefined);
    switch (span) {
        case undefined:
            return undefined;
        case 'month':
            return { span, year: parts.year, month: parts.month ?? 'current' };
        case 'quarter':
            return { span, year: parts.year, quarter: parts.quarter ?? 'current' };
        case 'now':
            return { span, month: 'current' };
        case 'all_time':
            return { span };
        default:
            return { span, year: parts.year ?? 'current' };
    }
}

/** The months of a period, before it is cut at the current month. */
function resolvePeriod(parts: Normalized, current: number): Months {
    const { span: kind } = parts;
    switch (kind) {
        case 'all_time':
            return { kind, last: current, relative: true };
        case 'month':
        case 'now': {
            const month = monthOf(parts.month ?? 'current', parts.year, current);
            return { kind, first: month.index, last: month.index, relative: month.relative };
        }
        case 'quarter': {
            const first = quarterOf(parts.quarter ?? 'current', parts.year, current);
            return { kind, first, last: first + 2, relative: false };
        }
        default:
            return yearMonths(kind, parts.year ?? 'current', current);
    }
}

/** A year, the year to date, or the last 12 months, in a year. */
function yearMonths(
    kind: 'year' | 'year_to_date' | 'last_12_months',
    year: YearPart,
    current: number
): Months & { first: number } {
    const relative = typeof year === 'string';
    const shift = (yearOf(year, current) - yearOf('current', current)) * 12;
    if (kind === 'last_12_months') {
        return { kind, first: current + shift - 11, last: current + shift, relative };
    }
    const first = yearStart(current) + shift;
    const last = kind === 'year' ? first + 11 : current + shift;
    return { kind, first, last, relative };
}

function yearOf(year: YearPart, current: number): number {
    const thisYear = Math.floor(current / 12);
    switch (year) {
        case 'current':
            return thisYear;
        case 'previous':
            return thisYear - 1;
        case 'before_previous':
            return thisYear - 2;
        default:
            return year;
    }
}

/**
 * The current or previous month is today's; in a year relative to today's, the same month that
 * many years away; in a written year, the same month of the year in it (December 2024 for last
 * month asked in January, with 2024). A named month in no year is the latest one that has started, or, with an `anchor`, the latest
 * one before that month.
 */
function monthOf(
    month: MonthPart,
    year: YearPart | undefined,
    current: number,
    anchor = current + 1
): { index: number; relative: boolean } {
    if (month === 'current' || month === 'previous') {
        const index = month === 'current' ? current : current - 1;
        if (year === undefined || year === 'current') {
            return { index, relative: true };
        }
        return { index: inYear(index, year, current), relative: typeof year === 'string' };
    }
    if (year !== undefined) {
        return { index: yearOf(year, current) * 12 + month - 1, relative: false };
    }
    return { index: latestBefore(month - 1, anchor), relative: false };
}

/** The first month of a quarter, found as {@link monthOf} finds a month. */
function quarterOf(
    quarter: QuarterPart,
    year: YearPart | undefined,
    current: number,
    anchor = current + 1
): number {
    if (quarter === 'current' || quarter === 'previous') {
        const first = quarterStart(current) - (quarter === 'previous' ? 3 : 0);
        return year === undefined ? first : inYear(first, year, current);
    }
    const monthOfYear = (quarter - 1) * 3;
    if (year !== undefined) {
        return yearOf(year, current) * 12 + monthOfYear;
    }
    return latestBefore(monthOfYear, anchor);
}

/**
 * A month of today's, moved to a year: as many years away as a relative year is from today's, or
 * to its own month of the year in a written year.
 */
function inYear(month: number, year: YearPart, current: number): number {
    return typeof year === 'number'
        ? year * 12 + (month % 12)
        : month + (yearOf(year, current) - yearOf('current', current)) * 12;
}

/** The latest month of the year at `monthOfYear` (January is 0) before `anchor`. */
function latestBefore(monthOfYear: number, anchor: number): number {
    const sameYear = yearStart(anchor) + monthOfYear;
    return sameYear < anchor ? sameYear : sameYear - 12;
}

/** The months a comparison reads, the error of one that cannot be read, or none. */
function compare(
    parts: Normalized,
    period: Months,
    request: PeriodRequest,
    current: number
): Months | ComparisonError | undefined {
    const compared = request.compared;
    const named =
        compared !== undefined &&
        (compared.year !== undefined ||
            compared.month !== undefined ||
            compared.quarter !== undefined);
    if (period.first === undefined) {
        return named || request.compareWith === 'year_earlier'
            ? 'comparison_unavailable'
            : undefined;
    }
    const length = period.last - period.first + 1;
    if (!named) {
        const shift = request.compareWith === 'year_earlier' ? 12 : unitLength(period.kind);
        return { ...period, first: period.first - shift, last: period.last - shift };
    }
    const first = comparedFirst(parts, compared, period.first, current);
    if (first === undefined) {
        return 'comparison_kind_mismatch';
    }
    if (first.index + length - 1 >= period.first && first.index <= period.last) {
        return 'comparison_not_earlier';
    }
    return {
        kind: period.kind,
        first: first.index,
        last: first.index + length - 1,
        relative: first.relative,
    };
}

/**
 * A comparison wholly later than the period, as the period, cut at the current month, and the
 * period as its comparison, over as many months; `undefined` when the later one has not started.
 * `length` is the months of the period before it was cut.
 */
function swap(
    period: Months,
    later: Months,
    length: number,
    current: number
): { period: Months; comparison: Months } | undefined {
    const first = later.first ?? current;
    if (first > current || period.first === undefined) {
        return undefined;
    }
    const last = Math.min(first + length - 1, current);
    return {
        period: { ...later, last },
        comparison: { ...period, last: period.first + last - first },
    };
}

/** The months one period of a kind spans; the current month for now. */
function unitLength(kind: PeriodSpan): number {
    switch (kind) {
        case 'month':
        case 'now':
            return 1;
        case 'quarter':
            return 3;
        default:
            return 12;
    }
}

/**
 * The first month of a named comparison, of the kind its own parts name (a month, else a quarter,
 * else the period's kind) and the period's parts where it names none, or `undefined` when that
 * kind is not the period's. A named month or quarter whose year neither names is the latest one
 * before the period.
 */
function comparedFirst(
    parts: Normalized,
    compared: ComparedParts,
    periodFirst: number,
    current: number
): { index: number; relative: boolean } | undefined {
    const unit = (kind: PeriodSpan) => (kind === 'now' ? 'month' : kind);
    const kind =
        compared.month !== undefined
            ? 'month'
            : compared.quarter !== undefined
              ? 'quarter'
              : parts.span;
    if (unit(kind) !== unit(parts.span)) {
        return undefined;
    }
    const year = compared.year ?? parts.year;
    switch (kind) {
        case 'month':
        case 'now':
            return monthOf(compared.month ?? parts.month ?? 'current', year, current, periodFirst);
        case 'quarter':
            return {
                index: quarterOf(
                    compared.quarter ?? parts.quarter ?? 'current',
                    year,
                    current,
                    periodFirst
                ),
                relative: false,
            };
        case 'all_time':
            return undefined;
        default: {
            const months = yearMonths(kind, year ?? 'current', current);
            return { index: months.first, relative: months.relative };
        }
    }
}

function periodDates(months: Months, nature: ReportNature, current: number): PeriodDates {
    return {
        dates: `${writeDates(months, nature, current)} by:m`,
        kind: months.kind,
        running: months.last >= current,
        ...(months.first === undefined ? {} : { first: monthText(months.first) }),
        last: monthText(months.last),
    };
}

/**
 * The query dates of months: activity within them, a position at their end. Relative months are
 * written with bare variables, others (and quarters, which have no variable) in ISO.
 */
function writeDates(months: Months, nature: ReportNature, current: number): string {
    const { kind, first, last } = months;
    const variables = months.relative && kind !== 'quarter';
    const yearAligned = kind === 'year' || kind === 'year_to_date';
    if (nature === 'position') {
        if (last >= current) {
            return 'before:$d+1';
        }
        const end = last + 1;
        if (!variables) {
            return `before:${monthText(end)}`;
        }
        return yearAligned && end % 12 === 0
            ? `before:${yearVariable(end / 12 - Math.floor(current / 12))}`
            : `before:${monthVariable(end - current)}`;
    }
    if (first === undefined) {
        return `before:${monthVariable(last + 1 - current)}`;
    }
    if (!variables) {
        if (first % 12 === 0 && last === first + 11) {
            return `on:${yearText(first / 12)}`;
        }
        return first === last
            ? `on:${monthText(first)}`
            : `after:${monthText(first)} before:${monthText(last + 1)}`;
    }
    if (yearAligned) {
        const year = yearVariable(first / 12 - Math.floor(current / 12));
        return last === first + 11 && last < current
            ? `on:${year}`
            : `after:${year} before:${monthVariable(last + 1 - current)}`;
    }
    return first === last
        ? `on:${monthVariable(first - current)}`
        : `after:${monthVariable(first - current)} before:${monthVariable(last + 1 - current)}`;
}

function yearVariable(offset: number): string {
    return `$y${signed(offset)}`;
}

function monthVariable(offset: number): string {
    return `$m${signed(offset)}`;
}

function signed(offset: number): string {
    return offset === 0 ? '' : offset > 0 ? `+${offset}` : `${offset}`;
}

function monthText(index: number): IsoMonth {
    return isoMonth(Math.floor(index / 12), (index % 12) + 1);
}

function yearText(year: number): string {
    return String(year).padStart(4, '0');
}

function monthOfDate(date: IsoDate): number {
    const match = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}$/.exec(date);
    if (!match) {
        throw new Error(`Invalid date: ${date}`);
    }
    return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function yearStart(month: number): number {
    return month - (month % 12);
}

function quarterStart(month: number): number {
    return month - (month % 3);
}

function assertParts(parts: ComparedParts): void {
    const { year, month, quarter } = parts;
    if (typeof year === 'number' && !(Number.isInteger(year) && isPlausibleYear(year))) {
        throw new Error(`Invalid year: ${year}`);
    }
    if (typeof month === 'number' && !(Number.isInteger(month) && month >= 1 && month <= 12)) {
        throw new Error(`Invalid month: ${month}`);
    }
    if (
        typeof quarter === 'number' &&
        !(Number.isInteger(quarter) && quarter >= 1 && quarter <= 4)
    ) {
        throw new Error(`Invalid quarter: ${quarter}`);
    }
}

const RELATIVE_ID_PARTS: Record<string, PeriodParts> = {
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
 * The parts of a period id (a relative id, `YYYY`, `YYYY-Qn` or `YYYY-MM`) and what it is
 * compared with, or `undefined` for anything else. Relative ids stay relative; dated ids are
 * fixed. All time had no comparison, so it keeps none.
 */
export function periodRequestOf(id: string, compareWith?: CompareWith): PeriodRequest | undefined {
    if (!isPeriodId(id)) {
        return undefined;
    }
    const relative = RELATIVE_ID_PARTS[id];
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
 * The months a query's dates read, as Bkper resolves them from the Book's today: `first` and
 * `last` are inclusive, and `beforeDay` is the exclusive day of `before:$d+1`.
 */
export interface QueryDates {
    first?: IsoMonth;
    last?: IsoMonth;
    beforeDay?: IsoDate;
}

/**
 * Resolves the dates {@link buildPeriodQuery} writes: `on:`, or `after:` and `before:`, followed
 * by `by:m`, each value a bare `$y±n` or `$m±n`, ISO `yyyy` or `yyyy-mm`, or `$d+1` in `before:`.
 * Throws for anything else, such as a full date, a variable combined with a month, or an
 * empty range.
 */
export function resolveQueryDates(query: string, today: IsoDate): QueryDates {
    const tokens = query.trim().split(/\s+/);
    if (tokens.pop() !== 'by:m') {
        throw new Error(`Query dates must end with by:m: ${query}`);
    }
    const current = monthOfDate(today);
    const bounds = new Map<string, string>();
    for (const token of tokens) {
        const match = /^(on|after|before):(\S+)$/.exec(token);
        if (!match || bounds.has(match[1])) {
            throw new Error(`Unsupported query dates: ${query}`);
        }
        bounds.set(match[1], match[2]);
    }
    const on = bounds.get('on');
    const after = bounds.get('after');
    const before = bounds.get('before');
    if (on !== undefined ? bounds.size !== 1 : bounds.size === 0) {
        throw new Error(`Unsupported query dates: ${query}`);
    }
    if (on !== undefined) {
        const value = dateValue(on, current, query);
        return { first: monthText(value.first), last: monthText(value.last) };
    }
    const first = after === undefined ? undefined : dateValue(after, current, query).first;
    let last: number | undefined;
    let beforeDay: IsoDate | undefined;
    if (before === '$d+1') {
        beforeDay = addDays(today, 1);
        last = current;
    } else if (before !== undefined) {
        last = dateValue(before, current, query).first - 1;
    }
    if (first !== undefined && last !== undefined && first > last) {
        throw new Error(`Empty query dates: ${query}`);
    }
    return {
        ...(first === undefined ? {} : { first: monthText(first) }),
        ...(last === undefined ? {} : { last: monthText(last) }),
        ...(beforeDay === undefined ? {} : { beforeDay }),
    };
}

/** The months a date value spans: a year's twelve, or one month. */
function dateValue(value: string, current: number, query: string): { first: number; last: number } {
    const variable = /^\$([ym])(?:([+-])(\d+))?$/.exec(value);
    if (variable) {
        const offset = variable[2] === undefined ? 0 : Number(`${variable[2]}${variable[3]}`);
        if (variable[1] === 'm') {
            return { first: current + offset, last: current + offset };
        }
        const first = yearStart(current) + offset * 12;
        return { first, last: first + 11 };
    }
    const iso = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(value);
    if (iso) {
        const year = Number(iso[1]) * 12;
        return iso[2] === undefined
            ? { first: year, last: year + 11 }
            : { first: year + Number(iso[2]) - 1, last: year + Number(iso[2]) - 1 };
    }
    throw new Error(`Unsupported query date ${value}: ${query}`);
}
