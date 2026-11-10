/**
 * Report periods: the default period of a request that names none, the Book's today, and
 * calendar helpers. A report's queries are not written here: `period-query.ts` builds them
 * from the parts of a period.
 *
 * Dates are calendar dates (`YYYY-MM-DD`) in the Book time zone. Only "today" depends on the
 * clock; everything else is plain calendar arithmetic.
 */

/** A calendar date, `YYYY-MM-DD`, in the Book time zone. */
export type IsoDate = string;

/** A calendar month, `YYYY-MM`. */
export type IsoMonth = string;

/** Activity happens within a period (Incoming, Outgoing); a position is measured to a date (Asset, Liability). */
export type ReportNature = 'activity' | 'position';

const DAY_MS = 86_400_000;

/** `YYYY-MM`, with the year padded to four digits so early years still sort and parse. */
export function isoMonth(year: number, monthOfYear: number): IsoMonth {
    return `${padYear(year)}-${pad(monthOfYear)}`;
}

/**
 * A year a period can name (the years an intent accepts). Movements outside
 * it, such as a typo dated 0012, still count in totals but never shape a default period.
 */
export function isPlausibleYear(year: number): boolean {
    return year >= 1000 && year <= 2999;
}

export interface DefaultPeriodContext {
    nature: ReportNature;
    /** The request asks how amounts evolve over time. */
    trend: boolean;
    today: IsoDate;
    /**
     * The last month the report's groups and accounts had movements, when known: a report
     * whose default period has none finds it with one query of their history.
     */
    lastActiveMonth?: IsoMonth;
}

/**
 * The period of a request that names none. Activity reads this year, a position today, and a
 * trend the last 12 months. Given the last month with movements, activity or a trend that
 * would have none reads the last year that has them instead, so a Book with old data still
 * shows its data.
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

function yearStart(month: number): number {
    return month - (month % 12);
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
