/**
 * Report periods: the options a request may choose from, and their exact date boundaries.
 *
 * Dates are calendar dates (`YYYY-MM-DD`) in the Book time zone, which is how Bkper reads
 * `after:` (inclusive) and `before:` (exclusive) in a query. Only "today" depends on the
 * clock; everything else is plain calendar arithmetic, so the same inputs always give the
 * same boundaries.
 */

/** A calendar date, `YYYY-MM-DD`, in the Book time zone. */
export type IsoDate = string;

/** A calendar month, `YYYY-MM`. */
export type IsoMonth = string;

/** Query boundaries: `after` is inclusive, `before` is exclusive. No `after` means since the beginning. */
export interface DateRange {
    after?: IsoDate;
    before: IsoDate;
}

/** First and last months with balances in the Book, both inclusive. */
export interface DataRange {
    firstMonth: IsoMonth;
    lastMonth: IsoMonth;
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

/** Upper bound of options in a single choice. */
export const MAX_PERIOD_OPTIONS = 255;

/** Relative ids, a year `YYYY`, a quarter `YYYY-Qn` or a month `YYYY-MM`. */
export const PERIOD_ID_PATTERN = new RegExp(
    `^(?:${RELATIVE_PERIODS.join('|')}|[12]\\d{3}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?)$`
);

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

export function isPeriodId(id: string): boolean {
    return PERIOD_ID_PATTERN.test(id);
}

export function defaultPeriod(nature: ReportNature): RelativePeriod {
    return nature === 'activity' ? 'this_year' : 'today';
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
    const month = monthIndexOfDate(today);
    const quarter = month - (month % 3);
    const year = month - (month % 12);
    switch (id) {
        case 'today':
            return { after: today, before: addDays(today, 1) };
        case 'this_month':
            return monthsRange(month, 1);
        case 'last_month':
            return monthsRange(month - 1, 1);
        case 'this_quarter':
            return monthsRange(quarter, 3);
        case 'last_quarter':
            return monthsRange(quarter - 3, 3);
        case 'this_year':
            return monthsRange(year, 12);
        case 'last_year':
            return monthsRange(year - 12, 12);
        case 'ytd':
            return { after: monthStart(year), before: addDays(today, 1) };
        case 'last_12_months':
            return monthsRange(month - 11, 12);
        case 'all': {
            const lastMonth = context.dataRange
                ? Math.max(month, parseMonth(context.dataRange.lastMonth))
                : month;
            return { before: monthStart(lastMonth + 1) };
        }
    }
}

function isRelativePeriod(id: string): id is RelativePeriod {
    return (RELATIVE_PERIODS as readonly string[]).includes(id);
}

/**
 * The period of the same length immediately before: the same number of months when both
 * boundaries start a month, otherwise the same number of days. All time has none.
 */
export function previousPeriod(range: DateRange): DateRange | undefined {
    const { after, before } = range;
    if (after === undefined) {
        return undefined;
    }
    if (isMonthStart(after) && isMonthStart(before)) {
        const months = monthIndexOfDate(before) - monthIndexOfDate(after);
        return monthsRange(monthIndexOfDate(after) - months, months);
    }
    const days = Math.round((dateMs(before) - dateMs(after)) / DAY_MS);
    return { after: addDays(after, -days), before: after };
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
    const first = parseMonth(range.firstMonth);
    const last = parseMonth(range.lastMonth);

    const years: CalendarPeriod[] = [];
    const quarters: CalendarPeriod[] = [];
    const months: CalendarPeriod[] = [];
    for (let month = last; month >= first; month--) {
        const { year, monthOfYear } = monthParts(month);
        months.push({ id: `${year}-${pad(monthOfYear)}`, end: month + 1, length: 1 });
        if (monthOfYear % 3 === 1 || month === first) {
            quarters.push({
                id: `${year}-Q${Math.ceil(monthOfYear / 3)}`,
                end: month - (month % 3) + 3,
                length: 3,
            });
        }
        if (monthOfYear === 1 || month === first) {
            years.push({ id: `${year}`, end: month - (month % 12) + 12, length: 12 });
        }
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
    return `${year}-${pad(monthOfYear)}-01`;
}

function monthsRange(first: number, length: number): DateRange {
    return { after: monthStart(first), before: monthStart(first + length) };
}

function isMonthStart(date: IsoDate): boolean {
    return date.endsWith('-01');
}

function dateMs(date: IsoDate): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) {
        throw new Error(`Invalid date: ${date}`);
    }
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date: IsoDate, days: number): IsoDate {
    return new Date(dateMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}
