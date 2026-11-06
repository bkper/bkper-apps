/**
 * Report periods: the options a request may choose from, and their exact date boundaries.
 *
 * Dates are calendar dates (`YYYY-MM-DD`) in the Book time zone, which is how Bkper reads
 * `after:` (inclusive) and `before:` (exclusive) in a query. Only "today" depends on the
 * clock; everything else is plain calendar arithmetic, so the same inputs always give the
 * same boundaries.
 *
 * Current periods (this month, quarter and year, year to date, the last 12 months and all
 * time) end at tomorrow: they include today and leave out future-dated transactions. Past
 * periods are whole calendar periods.
 */

import {
    PERIOD_ID_PATTERN,
    RELATIVE_PERIODS,
    type RelativePeriod,
} from 'report-shared/report-intent';

/** A calendar date, `YYYY-MM-DD`, in the Book time zone. */
export type IsoDate = string;

/** A calendar month, `YYYY-MM`. */
export type IsoMonth = string;

/** Query boundaries: `after` is inclusive, `before` is exclusive. No `after` means since the beginning. */
export interface DateRange {
    after?: IsoDate;
    before: IsoDate;
}

/**
 * First and last months with balances in the Book, both inclusive, in plausible calendar years
 * (see {@link isPlausibleYear}).
 */
export interface DataRange {
    firstMonth: IsoMonth;
    lastMonth: IsoMonth;
    /** Every month with movements within the range, ascending; absent in older snapshots. */
    activeMonths?: IsoMonth[];
}

export interface PeriodContext {
    today: IsoDate;
    dataRange?: DataRange;
}

export interface PeriodOption {
    id: string;
    /** English description with explicit dates, so the choice never needs date math. */
    description: string;
}

/** Activity happens within a period (Incoming, Outgoing); a position is measured to a date (Asset, Liability). */
export type ReportNature = 'activity' | 'position';

export { RELATIVE_PERIODS, PERIOD_ID_PATTERN, type RelativePeriod };

/** Upper bound of options in a single choice. */
export const MAX_PERIOD_OPTIONS = 255;

const RELATIVE_LABELS: Record<RelativePeriod, string> = {
    today: 'today',
    this_month: 'this month',
    last_month: 'last month',
    this_quarter: 'this quarter',
    last_quarter: 'last quarter',
    this_year: 'this year',
    last_year: 'last year',
    ytd: 'year to date',
    last_12_months: 'last 12 months',
    all: 'all time',
};

const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

const DAY_MS = 86_400_000;

/** `YYYY-MM`, with the year padded to four digits so early years still sort and parse. */
export function isoMonth(year: number, monthOfYear: number): IsoMonth {
    return `${padYear(year)}-${pad(monthOfYear)}`;
}

/**
 * A year a period can name (the years {@link PERIOD_ID_PATTERN} accepts). Movements outside
 * it, such as a typo dated 0012, still count in totals but never shape the period options.
 */
export function isPlausibleYear(year: number): boolean {
    return year >= 1000 && year <= 2999;
}

export function isPeriodId(id: string): boolean {
    return PERIOD_ID_PATTERN.test(id);
}

export interface DefaultPeriodContext {
    nature: ReportNature;
    /** The request asks how amounts evolve over time. */
    trend: boolean;
    today: IsoDate;
    /** The last month the report's groups had movements; absent when they never had. */
    lastActiveMonth?: IsoMonth;
}

/**
 * The period of a request that names none. Activity reads this year, a position today, and a
 * trend the last 12 months. When activity or a trend would have no movements, it reads the
 * last year that has them instead, so a Book with old data still shows its data.
 */
export function defaultPeriod(context: DefaultPeriodContext): string {
    const { nature, trend, today, lastActiveMonth } = context;
    const month = monthIndexOfDate(today);
    const last = lastActiveMonth === undefined ? undefined : parseMonth(lastActiveMonth);
    const lastYear = last === undefined ? '' : `${monthParts(last).year}`;
    if (trend) {
        return last === undefined || last >= month - 11 ? 'last_12_months' : lastYear;
    }
    if (nature === 'position') {
        return 'today';
    }
    return last === undefined || last >= yearStart(month) ? 'this_year' : lastYear;
}

/** The calendar date of `now` in the Book time zone; Books without a time zone use UTC. */
export function todayInTimeZone(now: Date, timeZone: string | undefined): IsoDate {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find(p => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Boundaries of a period id, or `undefined` when the id is not a period. */
export function resolvePeriod(id: string, context: PeriodContext): DateRange | undefined {
    if (!isPeriodId(id)) {
        return undefined;
    }
    if (isRelativePeriod(id)) {
        return resolveRelative(id, context);
    }
    const [yearText, rest] = id.split('-');
    const first = Number(yearText) * 12;
    if (rest === undefined) {
        return monthsRange(first, 12);
    }
    if (rest.startsWith('Q')) {
        return monthsRange(first + (Number(rest.slice(1)) - 1) * 3, 3);
    }
    return monthsRange(first + Number(rest) - 1, 1);
}

function resolveRelative(id: RelativePeriod, context: PeriodContext): DateRange {
    const today = context.today;
    const tomorrow = addDays(today, 1);
    const month = monthIndexOfDate(today);
    switch (id) {
        case 'today':
            return { after: today, before: tomorrow };
        case 'last_month':
            return monthsRange(month - 1, 1);
        case 'last_quarter':
            return monthsRange(quarterStart(month) - 3, 3);
        case 'last_year':
            return monthsRange(yearStart(month) - 12, 12);
        case 'all':
            return { before: tomorrow };
        default:
            return { after: monthStart(toDateStart(id, month)), before: tomorrow };
    }
}

/** Current periods run "to date": from their first month up to and including today. */
const TO_DATE_MONTHS = {
    this_month: 1,
    this_quarter: 3,
    this_year: 12,
    ytd: 12,
    last_12_months: 12,
} as const;

type ToDatePeriod = keyof typeof TO_DATE_MONTHS;

function isToDatePeriod(id: string): id is ToDatePeriod {
    return Object.hasOwn(TO_DATE_MONTHS, id);
}

function toDateStart(id: ToDatePeriod, month: number): number {
    switch (id) {
        case 'this_month':
            return month;
        case 'this_quarter':
            return quarterStart(month);
        case 'this_year':
        case 'ytd':
            return yearStart(month);
        case 'last_12_months':
            return month - 11;
    }
}

function isRelativePeriod(id: string): id is RelativePeriod {
    return (RELATIVE_PERIODS as readonly string[]).includes(id);
}

/**
 * The period to compare with, calendar-aligned.
 *
 * Activity compares with the previous comparable period: the previous month, quarter or
 * year of a whole period, and the same span one period back for a current period, with
 * the day clamped to the end of a shorter month (this month on the 31st compares with
 * the whole of February). Today compares with yesterday.
 *
 * A position compares with the position at the end of the previous period, which is the
 * start of this one (for today, the end of last month); the result then has only `before`.
 *
 * All time has nothing to compare with.
 */
export function previousPeriod(
    id: string,
    nature: ReportNature,
    context: PeriodContext
): DateRange | undefined {
    const range = resolvePeriod(id, context);
    if (!range?.after) {
        return undefined;
    }
    if (nature === 'position') {
        const before = id === 'today' ? monthStart(monthIndexOfDate(context.today)) : range.after;
        return { before };
    }
    if (id === 'today') {
        return { after: addDays(range.after, -1), before: range.after };
    }
    const months = isToDatePeriod(id)
        ? TO_DATE_MONTHS[id]
        : monthIndexOfDate(range.before) - monthIndexOfDate(range.after);
    const after = monthStart(monthIndexOfDate(range.after) - months);
    const before = isToDatePeriod(id)
        ? addDays(shiftMonths(context.today, -months), 1)
        : range.after;
    return { after, before };
}

/**
 * Every period a request may choose: the relative periods, then each year, quarter and month
 * within the data range, most recent first. Long histories keep every year and the most
 * recent quarters and months that fit in {@link MAX_PERIOD_OPTIONS}.
 */
export function buildPeriodOptions(context: PeriodContext): PeriodOption[] {
    const relative = RELATIVE_PERIODS.map(id => option(id, context));
    const range = context.dataRange;
    if (!range) {
        return relative;
    }
    const years: CalendarPeriod[] = [];
    const quarters: CalendarPeriod[] = [];
    const months: CalendarPeriod[] = [];
    const seen = new Set<string>();
    const add = (list: CalendarPeriod[], period: CalendarPeriod) => {
        if (!seen.has(period.id)) {
            seen.add(period.id);
            list.push(period);
        }
    };
    for (const month of candidateMonths(range)) {
        const { year, monthOfYear } = monthParts(month);
        if (!isPlausibleYear(year)) {
            continue;
        }
        add(months, { id: isoMonth(year, monthOfYear), end: month + 1, length: 1 });
        add(quarters, {
            id: `${padYear(year)}-Q${Math.ceil(monthOfYear / 3)}`,
            end: quarterStart(month) + 3,
            length: 3,
        });
        add(years, { id: padYear(year), end: yearStart(month) + 12, length: 12 });
    }

    const keptYears = years.slice(0, Math.max(0, MAX_PERIOD_OPTIONS - relative.length));
    const room = Math.max(0, MAX_PERIOD_OPTIONS - relative.length - keptYears.length);
    const kept = new Set(
        [...quarters, ...months]
            .sort((a, b) => b.end - a.end || b.length - a.length)
            .slice(0, room)
            .map(period => period.id)
    );
    const specific = [
        ...keptYears,
        ...quarters.filter(q => kept.has(q.id)),
        ...months.filter(m => kept.has(m.id)),
    ];
    return [...relative, ...specific.map(period => option(period.id, context))];
}

interface CalendarPeriod {
    id: string;
    /** Month index right after the period. */
    end: number;
    /** Length in months. */
    length: number;
}

function option(id: string, context: PeriodContext): PeriodOption {
    const range = resolvePeriod(id, context);
    if (!range) {
        throw new Error(`Invalid period id: ${id}`);
    }
    return { id, description: describe(id, range) };
}

function describe(id: string, range: DateRange): string {
    const lastDay = addDays(range.before, -1);
    if (id === 'all') {
        return `all time, everything up to ${lastDay}`;
    }
    const dates = range.after === lastDay ? `${lastDay}` : `${range.after} to ${lastDay}`;
    return `${label(id)}, ${dates}`;
}

function label(id: string): string {
    if (isRelativePeriod(id)) {
        return RELATIVE_LABELS[id];
    }
    const [year, rest] = id.split('-');
    if (rest === undefined) {
        return `year ${year}`;
    }
    if (rest.startsWith('Q')) {
        return `${year} ${rest}`;
    }
    return `${MONTH_NAMES[Number(rest) - 1]} ${year}`;
}

/** Months are counted as `year * 12 + (month - 1)` so month arithmetic is integer arithmetic. */
function monthIndexOfDate(date: IsoDate): number {
    return parseMonth(date.slice(0, 7));
}

function parseMonth(month: IsoMonth): number {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!match) {
        throw new Error(`Invalid month: ${month}`);
    }
    return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function monthParts(index: number): { year: number; monthOfYear: number } {
    return { year: Math.floor(index / 12), monthOfYear: (index % 12) + 1 };
}

function monthStart(index: number): IsoDate {
    const { year, monthOfYear } = monthParts(index);
    return `${isoMonth(year, monthOfYear)}-01`;
}

/** Month indexes to offer, most recent first: the active months, else every month in the range. */
function candidateMonths(range: DataRange): number[] {
    if (range.activeMonths) {
        return [...new Set(range.activeMonths.map(parseMonth))].sort((a, b) => b - a);
    }
    const months: number[] = [];
    for (let month = parseMonth(range.lastMonth); month >= parseMonth(range.firstMonth); month--) {
        months.push(month);
    }
    return months;
}

function quarterStart(month: number): number {
    return month - (month % 3);
}

function yearStart(month: number): number {
    return month - (month % 12);
}

/** The same day `months` later or earlier, clamped to the end of a shorter month. */
function shiftMonths(date: IsoDate, months: number): IsoDate {
    const target = monthIndexOfDate(date) + months;
    const lastDay = Number(addDays(monthStart(target + 1), -1).slice(8));
    const day = Math.min(Number(date.slice(8)), lastDay);
    return `${monthStart(target).slice(0, 8)}${pad(day)}`;
}

function monthsRange(first: number, length: number): DateRange {
    return { after: monthStart(first), before: monthStart(first + length) };
}

function dateMs(date: IsoDate): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) {
        throw new Error(`Invalid date: ${date}`);
    }
    // Date.UTC reads years 0–99 as 1900–1999; setUTCFullYear keeps them as written.
    const utc = new Date(0);
    utc.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return utc.getTime();
}

export function addDays(date: IsoDate, days: number): IsoDate {
    return new Date(dateMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function padYear(year: number): string {
    return String(year).padStart(4, '0');
}
