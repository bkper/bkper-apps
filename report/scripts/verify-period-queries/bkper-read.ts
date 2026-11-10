/**
 * What Bkper reads from a query's dates, and what the period query resolver expects it to read,
 * with Bkper's range and labels read in the Book's date format (`bkper-dates.ts`). Pure, so it
 * can be unit-tested apart from live Books.
 */
import { addDays, type IsoDate } from '../../server/src/services/periods.ts';
import type { QueryDates } from '../../server/src/services/period-query.ts';
import {
    parseBookDate,
    readRange,
    type BookDatePattern,
} from '../../server/src/services/bkper-dates.ts';

/** What Bkper returns for a query, as far as its dates go. */
export interface BkperRead {
    range?: string;
    rangeBeginLabel?: string;
    rangeEndLabel?: string;
    periodicity?: string;
    /** The balances of the group the query reads, one per month (or day). */
    balances: { year?: number; month?: number; day?: number }[];
}

/** What Bkper should read for dates the resolver resolved. */
export interface ExpectedRead {
    /** The first day read; none when the query reads from the start of the Book. */
    after?: IsoDate;
    /** The day after the last day read. */
    before: IsoDate;
    /** Within a period, exactly its months; from the start, no month after `before`'s. */
    months: { exactly: string[] } | { upTo: string };
}

export function expectedRead(dates: QueryDates): ExpectedRead {
    if (dates.last === undefined) {
        throw new Error('Query dates read up to no month');
    }
    const before = dates.beforeDay ?? addDays(lastDayOf(dates.last), 1);
    if (dates.first === undefined) {
        // From the start of the Book, Bkper lists the months with movements and the month of
        // `before` itself, so only months after that one would be wrong.
        return { before, months: { upTo: before.slice(0, 7) } };
    }
    return {
        after: `${dates.first}-01`,
        before,
        months: { exactly: monthsFrom(dates.first, dates.last) },
    };
}

/** Every way what Bkper read differs from what was expected; none when they agree. */
export function readMismatches(
    expected: ExpectedRead,
    read: BkperRead,
    pattern: BookDatePattern
): string[] {
    const mismatches: string[] = [];
    const differs = (what: string, actual: string | undefined, wanted: string | undefined) => {
        if (actual !== wanted) {
            mismatches.push(`${what} ${actual ?? '-'}, expected ${wanted ?? '-'}`);
        }
    };
    const attempt = <T>(what: string, parse: () => T): T | undefined => {
        try {
            return parse();
        } catch (error) {
            mismatches.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    };
    differs('periodicity', read.periodicity, 'MONTHLY');
    const range = attempt('range', () => readRange(read.range ?? '', pattern));
    if (range) {
        differs('range after', range.after, expected.after);
        differs('range before', range.before, expected.before);
        differs('range by', range.by, 'm');
    }
    const beginLabel = read.rangeBeginLabel;
    if (beginLabel) {
        const begin = attempt('begin label', () => parseBookDate(beginLabel, pattern));
        if (begin) {
            differs('begin label', begin, expected.after);
        }
    } else {
        differs('begin label', undefined, expected.after);
    }
    const end = attempt('end label', () => parseBookDate(read.rangeEndLabel ?? '', pattern));
    if (end) {
        differs('end label', end, addDays(expected.before, -1));
    }
    const days = read.balances.filter(balance => balance.day);
    if (days.length > 0) {
        mismatches.push(`${days.length} balances by day`);
    }
    const months = balanceMonths(read);
    if ('exactly' in expected.months) {
        differs('months', months.join(' '), expected.months.exactly.join(' '));
    } else {
        const upTo = expected.months.upTo;
        const later = months.filter(month => month > upTo);
        if (later.length > 0) {
            mismatches.push(`months after ${upTo}: ${later.join(' ')}`);
        }
    }
    return mismatches;
}

/** The months of the balances, `YYYY-MM`, in Bkper's order. */
export function balanceMonths(read: BkperRead): string[] {
    return read.balances.map(({ year, month }) => `${pad(year ?? 0, 4)}-${pad(month ?? 0, 2)}`);
}

function pad(value: number, digits: number): string {
    return String(value).padStart(digits, '0');
}

function nextMonth(month: string): string {
    const [year, monthOfYear] = month.split('-').map(Number);
    return monthOfYear === 12
        ? `${pad(year + 1, 4)}-01`
        : `${pad(year, 4)}-${pad(monthOfYear + 1, 2)}`;
}

function lastDayOf(month: string): IsoDate {
    return addDays(`${nextMonth(month)}-01`, -1);
}

function monthsFrom(first: string, last: string): string[] {
    const months: string[] = [];
    for (let month = first; month <= last; month = nextMonth(month)) {
        months.push(month);
    }
    return months;
}
