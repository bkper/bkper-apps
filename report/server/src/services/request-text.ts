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
import { isolate } from 'report-shared/bidi';
import type { ComparedParts, PeriodParts, PeriodSpan, YearPart } from 'report-shared/report-intent';
import { t, type StringKey } from 'report-shared/strings';
import type { ReportIntent } from './report-intent.js';

/** The request of a report titled `title`, in a language. */
export function requestText(intent: ReportIntent, title: string, lang: string): string {
    const words = new PeriodWords(lang);
    const compared = intent.compared
        ? words.period(comparedPeriod(intent.period, intent.compared))
        : intent.compareWith === 'year_earlier'
          ? t('request_year_earlier', lang)
          : undefined;
    const period = words.period(intent.period);
    return `${title} ${
        compared === undefined ? period : fill('request_versus', lang, { period, compared })
    }`;
}

/**
 * The period compared with, whole: its own parts, and the period's where it names none, of the
 * kind its own parts name (a month, else a quarter, else the period's), as the query builder
 * reads it.
 */
function comparedPeriod(period: PeriodParts, compared: ComparedParts): PeriodParts {
    const span: PeriodSpan =
        compared.month !== undefined
            ? 'month'
            : compared.quarter !== undefined
              ? 'quarter'
              : spanOf(period);
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

/** The words of periods in one language. */
class PeriodWords {
    private readonly relative: Intl.RelativeTimeFormat;
    private readonly number: Intl.NumberFormat;
    /** A year's digits alone: a quarter's label writes its own words around them. */
    private readonly digits: Intl.NumberFormat;

    constructor(readonly lang: string) {
        this.relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
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
            case 'year_to_date':
                return this.inYear(t('request_year_to_date', this.lang), year);
            case 'last_12_months':
                return this.inYear(t('request_last_12_months', this.lang), year);
            case 'quarter': {
                const quarter = parts.quarter ?? 'current';
                if (typeof quarter === 'string') {
                    return this.inYear(this.relativeUnit(quarter, 'quarter'), otherYear(year));
                }
                const number = this.number.format(quarter);
                return typeof year === 'number'
                    ? fill('period_quarter', this.lang, {
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

    /** A period within a year; within this year, a relative month or quarter says enough. */
    private inYear(period: string, year: YearPart | undefined): string {
        return year === undefined
            ? period
            : fill('request_in_year', this.lang, { period, year: this.year(year) });
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
        return new Intl.DateTimeFormat(this.lang, { ...options, timeZone: 'UTC' }).format(date);
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
