/**
 * The request a report stands for, as a person would type it: its title, then its period as the
 * intent's parts say it, then what it is compared with. It is the text a link to the report
 * opens with in the app's input and the `q` of its link, so a person can edit it and ask again:
 * relative parts stay in relative words (`Expenses this year`, `Revenue last year vs. 2023`,
 * `Bank now`), never the dates they read today, and written ones stay as written
 * (`Expenses Q3 2024 vs. Q1 2024`).
 *
 * Relative words come from `Intl.RelativeTimeFormat` (this year, last quarter, now…) in the
 * report's language; the others from the strings. Values written into a text are isolated, as in
 * every text of a report; `reportText` takes them out.
 */
import { isolate, withoutIsolates } from 'report-shared/bidi';
import {
    MIN_YEAR,
    type ComparedParts,
    type PeriodParts,
    type PeriodRequest,
    type PeriodSpan,
    type RelativeYear,
    type YearPart,
} from 'report-shared/report-intent';
import { t, type StringKey } from 'report-shared/strings';

/** The request of a report titled `title`, in a language. */
export function requestText(request: PeriodRequest, title: string, lang: string): string {
    const { period, compared } = periodTexts(request, lang);
    return `${title} ${
        compared === undefined ? period : fill('request_versus', lang, { period, compared })
    }`;
}

/**
 * The words of a request's period and of what it is compared with, in a language. A comparison
 * that would read as the period itself is left out: the two would be the same months.
 */
export function periodTexts(
    request: PeriodRequest,
    lang: string
): { period: string; compared?: string } {
    const words = periodWords(lang);
    const period = words.period(request.period);
    const earlier = request.compareWith === 'year_earlier' ? yearBefore(request.period) : undefined;
    const compared = request.compared
        ? words.compared(request.period, request.compared)
        : earlier !== undefined
          ? words.compared(request.period, { year: earlier })
          : request.compareWith === 'year_earlier'
            ? t('request_year_earlier', lang)
            : undefined;
    return compared === undefined || withoutIsolates(compared) === withoutIsolates(period)
        ? { period }
        : { period, compared };
}

/**
 * The period compared with, whole: its own parts, and the period's where it names none, of the
 * kind its own parts name (a month, else a quarter, else the period's), as the query builder
 * reads it.
 */
function comparedPeriod(period: PeriodParts, compared: ComparedParts): PeriodParts {
    const span = comparedSpan(period, compared);
    const year = compared.year ?? period.year;
    const month = span === 'month' ? (compared.month ?? period.month) : undefined;
    const quarter = span === 'quarter' ? (compared.quarter ?? period.quarter) : undefined;
    return {
        span,
        ...(year === undefined ? {} : { year }),
        ...(month === undefined ? {} : { month }),
        ...(quarter === undefined ? {} : { quarter }),
    };
}

/** The kind of period compared with: a month when it names one, else a quarter, else the period's. */
function comparedSpan(period: PeriodParts, compared: ComparedParts): PeriodSpan {
    return compared.month !== undefined
        ? 'month'
        : compared.quarter !== undefined
          ? 'quarter'
          : spanOf(period);
}

/**
 * The parts of the period compared with that differ from the period's own, as the query builder
 * reads both: parts equal to the period's say no other period, and parts of another kind than
 * the comparison's are not read.
 */
function ownParts(period: PeriodParts, compared: ComparedParts): ComparedParts {
    const span = spanOf(period);
    const kind = comparedSpan(period, compared);
    const sameKind = unitOf(kind) === unitOf(span);
    const differs = <T>(part: T | undefined, own: T | undefined) =>
        part !== undefined && !(sameKind && part === own) ? part : undefined;
    const year = differs(compared.year, yearOf(period));
    const month = kind === 'month' ? differs(compared.month, period.month ?? 'current') : undefined;
    const quarter =
        kind === 'quarter' ? differs(compared.quarter, period.quarter ?? 'current') : undefined;
    return {
        ...(year === undefined ? {} : { year }),
        ...(month === undefined ? {} : { month }),
        ...(quarter === undefined ? {} : { quarter }),
    };
}

/**
 * The year before a period's, where words can say it: a period in a written year or last year
 * is compared a year earlier with the same months of the year before, which reads more surely
 * than "a year earlier", often read as last year. Any other period has none.
 */
function yearBefore(period: PeriodParts): YearPart | undefined {
    const year = yearOf(period);
    return typeof year === 'number'
        ? year > MIN_YEAR
            ? year - 1
            : undefined
        : year === 'previous'
          ? 'before_previous'
          : undefined;
}

/** Now is read by month. */
function unitOf(span: PeriodSpan): PeriodSpan {
    return span === 'now' ? 'month' : span;
}

/**
 * The year a period is in, as the query builder reads it: this year unless it names another,
 * except a named month or quarter with no year (the latest one that has started), and all time.
 */
function yearOf(period: PeriodParts): YearPart | undefined {
    switch (spanOf(period)) {
        case 'all_time':
            return undefined;
        case 'now':
            return 'current';
        case 'month':
            return typeof period.month === 'number' ? period.year : (period.year ?? 'current');
        case 'quarter':
            return typeof period.quarter === 'number' ? period.year : (period.year ?? 'current');
        default:
            return period.year ?? 'current';
    }
}

/** A period without a span is a month when it names one, else a quarter, else a year. */
function spanOf(parts: PeriodParts): PeriodSpan {
    return (
        parts.span ??
        (parts.month !== undefined ? 'month' : parts.quarter !== undefined ? 'quarter' : 'year')
    );
}

/** This month or quarter is this year's: only another year is said. */
function otherYear(year: YearPart | undefined): YearPart | undefined {
    return year === 'current' ? undefined : year;
}

const WORDS = new Map<string, PeriodWords>();

/** The words of periods in a language, made once. */
function periodWords(lang: string): PeriodWords {
    let words = WORDS.get(lang);
    if (!words) {
        words = new PeriodWords(lang);
        WORDS.set(lang, words);
    }
    return words;
}

/** The words of periods in one language. */
class PeriodWords {
    private readonly relative: Intl.RelativeTimeFormat;
    /** Years ago in numbers (1 year ago), where `relative` says last year. */
    private readonly ago: Intl.RelativeTimeFormat;
    private readonly number: Intl.NumberFormat;
    /** A year's digits alone: a quarter's label writes its own words around them. */
    private readonly digits: Intl.NumberFormat;
    private readonly dates = new Map<string, Intl.DateTimeFormat>();

    constructor(readonly lang: string) {
        this.relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
        this.ago = new Intl.RelativeTimeFormat(lang, { numeric: 'always' });
        this.number = new Intl.NumberFormat(lang);
        this.digits = new Intl.NumberFormat(lang, { useGrouping: false });
    }

    period(parts: PeriodParts): string {
        const { year } = parts;
        switch (spanOf(parts)) {
            case 'all_time':
                return t('request_all_time', this.lang);
            case 'now':
                return this.relative.format(0, 'second');
            case 'year':
                return this.year(year ?? 'current');
            case 'year_to_date': {
                // Its own words in another year: in some languages year to date ends with the
                // word year, which a year said in words would repeat.
                const other = otherYear(year);
                return other === undefined
                    ? t('request_year_to_date', this.lang)
                    : fill('request_year_to_date_in_year', this.lang, { year: this.year(other) });
            }
            case 'last_12_months':
                return this.inYear(t('request_last_12_months', this.lang), otherYear(year));
            case 'quarter': {
                const quarter = parts.quarter ?? 'current';
                if (typeof quarter === 'string') {
                    return this.inYear(this.relativeUnit(quarter, 'quarter'), otherYear(year));
                }
                const number = this.number.format(quarter);
                return typeof year === 'number'
                    ? fill('request_quarter_in_year', this.lang, {
                          quarter: number,
                          year: this.digits.format(year),
                      })
                    : this.inYear(fill('request_quarter', this.lang, { quarter: number }), year);
            }
            case 'month': {
                const month = parts.month ?? 'current';
                if (typeof month === 'string') {
                    return this.inYear(this.relativeUnit(month, 'month'), otherYear(year));
                }
                return typeof year === 'number'
                    ? this.format(year, month, { month: 'long', year: 'numeric' })
                    : this.inYear(this.format(2000, month, { month: 'long' }), year);
            }
        }
    }

    /**
     * The period compared with. Named in a year only, it is said relative to the period where the
     * period's month, quarter or months are relative: the same month last year, the same months
     * 2023, or, for now, 1 year ago; otherwise whole, as {@link period} says it. Its parts equal
     * to the period's say no other period: a named month or quarter in no year, compared with
     * itself, is the one a year earlier, and anything else is the period itself (`undefined`).
     */
    compared(period: PeriodParts, compared: ComparedParts): string | undefined {
        const own = ownParts(period, compared);
        if (own.month !== undefined || own.quarter !== undefined) {
            return this.period(comparedPeriod(period, compared));
        }
        const span = spanOf(period);
        if (own.year === undefined) {
            return yearOf(period) === undefined && compared.year === undefined
                ? t('request_year_earlier', this.lang)
                : undefined;
        }
        const year = own.year;
        switch (span) {
            case 'month':
                return typeof period.month === 'number'
                    ? this.period(comparedPeriod(period, compared))
                    : this.inYear(t('request_same_month', this.lang), year);
            case 'quarter':
                return typeof period.quarter === 'number'
                    ? this.period(comparedPeriod(period, compared))
                    : this.inYear(t('request_same_quarter', this.lang), year);
            case 'year_to_date':
            case 'last_12_months':
                return this.inYear(t('request_same_months', this.lang), year);
            case 'now':
                return typeof year === 'number'
                    ? this.inYear(t('request_same_month', this.lang), year)
                    : this.yearsAgo(year);
            default:
                return this.year(year);
        }
    }

    /** A period within a year; within this year, a relative month or quarter says enough. */
    private inYear(period: string, year: YearPart | undefined): string {
        return year === undefined
            ? period
            : fill('request_in_year', this.lang, { period, year: this.year(year) });
    }

    /** A year relative to today's in years ago: 1 year ago, 2 years ago. */
    private yearsAgo(year: RelativeYear): string {
        return year === 'current'
            ? this.year(year)
            : this.ago.format(year === 'previous' ? -1 : -2, 'year');
    }

    /** This or last month or quarter. */
    private relativeUnit(unit: 'current' | 'previous', of: 'month' | 'quarter'): string {
        return this.relative.format(unit === 'current' ? 0 : -1, of);
    }

    /** A year relative to today's, in words, or a written year, in the language's digits. */
    private year(year: YearPart): string {
        switch (year) {
            case 'current':
                return this.relative.format(0, 'year');
            case 'previous':
                return this.relative.format(-1, 'year');
            case 'before_previous':
                return this.relative.format(-2, 'year');
            default:
                return this.format(year, 1, { year: 'numeric' });
        }
    }

    private format(year: number, month: number, options: Intl.DateTimeFormatOptions): string {
        const date = new Date(0);
        date.setUTCFullYear(year, month - 1, 1);
        const key = JSON.stringify(options);
        let format = this.dates.get(key);
        if (!format) {
            format = new Intl.DateTimeFormat(this.lang, { ...options, timeZone: 'UTC' });
            this.dates.set(key, format);
        }
        return format.format(date);
    }
}

/** The text of a key with values written into it, each isolated. */
function fill(key: StringKey, lang: string, params: Record<string, string>): string {
    return t(
        key,
        lang,
        Object.fromEntries(Object.entries(params).map(([name, value]) => [name, isolate(value)]))
    );
}
