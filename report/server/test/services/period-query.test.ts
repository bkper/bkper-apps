import { describe, expect, it } from 'vitest';
import {
    PERIOD_SPANS,
    buildPeriodQuery,
    periodRequestOf,
    resolveQueryDates,
    type MonthPart,
    type PeriodDates,
    type PeriodRequest,
    type QuarterPart,
    type YearPart,
} from '../../src/services/period-query';
import { addDays, type ReportNature } from '../../src/services/periods';
import { RELATIVE_PERIODS } from 'report-shared/report-intent';

const TODAY = '2026-11-09';

/** The dates of a period and of its comparison, or the reason there are none. */
function dates(request: PeriodRequest, nature: ReportNature = 'activity', today = TODAY) {
    const built = buildPeriodQuery(request, { today, nature });
    if (!built.ok) {
        return built.reason;
    }
    return [built.period.dates, built.comparison?.dates ?? built.comparisonError];
}

describe('buildPeriodQuery, as of 2026-11-09', () => {
    it('compares this year with the same months of last year', () => {
        expect(dates({ period: { year: 'current' }, compared: { year: 'previous' } })).toEqual([
            'after:$y before:$m+1 by:m',
            'after:$y-1 before:$m-11 by:m',
        ]);
    });

    it('compares last year with a year written in the request, whole', () => {
        expect(dates({ period: { year: 'previous' }, compared: { year: 2023 } })).toEqual([
            'on:$y-1 by:m',
            'on:2023 by:m',
        ]);
    });

    it('compares January with January last year', () => {
        expect(dates({ period: { month: 1 }, compared: { year: 'previous' } })).toEqual([
            'on:2026-01 by:m',
            'on:2025-01 by:m',
        ]);
    });

    it('reads last month against the month before', () => {
        expect(dates({ period: { month: 'previous' } })).toEqual(['on:$m-1 by:m', 'on:$m-2 by:m']);
    });

    it('reads a quarter of a written year against the quarter before', () => {
        expect(dates({ period: { quarter: 1, year: 2016 } })).toEqual([
            'after:2016-01 before:2016-04 by:m',
            'after:2015-10 before:2016-01 by:m',
        ]);
    });

    it('reads the year to date against the same months a year earlier', () => {
        expect(dates({ period: { span: 'year_to_date' } })).toEqual([
            'after:$y before:$m+1 by:m',
            'after:$y-1 before:$m-11 by:m',
        ]);
    });

    it('reads the last 12 months against the 12 before', () => {
        expect(dates({ period: { span: 'last_12_months' } })).toEqual([
            'after:$m-11 before:$m+1 by:m',
            'after:$m-23 before:$m-11 by:m',
        ]);
    });

    it('cuts this quarter at the end of this month, and compares the same months', () => {
        expect(dates({ period: { quarter: 'current' } })).toEqual([
            'after:2026-10 before:2026-12 by:m',
            'after:2026-07 before:2026-09 by:m',
        ]);
        expect(dates({ period: { quarter: 'current' }, compared: { year: 'previous' } })).toEqual([
            'after:2026-10 before:2026-12 by:m',
            'after:2025-10 before:2025-12 by:m',
        ]);
        expect(dates({ period: { quarter: 'current' }, compareWith: 'year_earlier' })).toEqual([
            'after:2026-10 before:2026-12 by:m',
            'after:2025-10 before:2025-12 by:m',
        ]);
    });

    it('compares this month with the same month last year', () => {
        expect(dates({ period: { span: 'month' }, compared: { year: 'previous' } })).toEqual([
            'on:$m by:m',
            'on:$m-12 by:m',
        ]);
    });

    it('reads a balance now against the same month a year ago, or the end of last month', () => {
        expect(dates({ period: { span: 'now' }, compareWith: 'year_earlier' }, 'position')).toEqual(
            ['before:$d+1 by:m', 'before:$m-11 by:m']
        );
        expect(dates({ period: { span: 'now' } }, 'position')).toEqual([
            'before:$d+1 by:m',
            'before:$m by:m',
        ]);
    });

    it('reads activity now as the current month', () => {
        expect(dates({ period: { span: 'now' } })).toEqual(['on:$m by:m', 'on:$m-1 by:m']);
    });

    it('reads a month that has not come this year in the year before', () => {
        expect(dates({ period: { month: 12 } })).toEqual(['on:2025-12 by:m', 'on:2025-11 by:m']);
    });

    it('compares Q3 with Q1 of the same year', () => {
        expect(dates({ period: { quarter: 3 }, compared: { quarter: 1 } })).toEqual([
            'after:2026-07 before:2026-10 by:m',
            'after:2026-01 before:2026-04 by:m',
        ]);
    });

    it('compares two written years', () => {
        expect(dates({ period: { year: 2016 }, compared: { year: 2014 } })).toEqual([
            'on:2016 by:m',
            'on:2014 by:m',
        ]);
    });

    it('inherits the month of the period in the comparison', () => {
        expect(dates({ period: { month: 1 }, compared: { year: 2019 } })).toEqual([
            'on:2026-01 by:m',
            'on:2019-01 by:m',
        ]);
    });

    it('places last month in a written year at its own month, across a new year', () => {
        const january = '2026-01-15';
        expect(
            dates({ period: { month: 'previous' }, compared: { year: 2024 } }, 'activity', january)
        ).toEqual(['on:$m-1 by:m', 'on:2024-12 by:m']);
        expect(
            dates(
                { period: { quarter: 'previous' }, compared: { year: 2024 } },
                'activity',
                january
            )
        ).toEqual(['after:2025-10 before:2026-01 by:m', 'after:2024-10 before:2025-01 by:m']);
        expect(
            dates(
                { period: { month: 'previous' }, compared: { year: 'previous' } },
                'activity',
                january
            )
        ).toEqual(['on:$m-1 by:m', 'on:$m-13 by:m']);
    });

    it('rejects a period that has not started', () => {
        expect(dates({ period: { year: 2027 } })).toBe('future_period');
        expect(dates({ period: { month: 12, year: 2026 } })).toBe('future_period');
    });

    it('swaps a comparison wholly later than the period, so the later one is read', () => {
        expect(dates({ period: { year: 2016 }, compared: { year: 2018 } })).toEqual([
            'on:2018 by:m',
            'on:2016 by:m',
        ]);
        expect(
            dates({ period: { year: 2025, month: 3 }, compared: { year: 2025, month: 4 } })
        ).toEqual(['on:2025-04 by:m', 'on:2025-03 by:m']);
        expect(dates({ period: { month: 'previous' }, compared: { month: 'current' } })).toEqual([
            'on:$m by:m',
            'on:$m-1 by:m',
        ]);
    });

    it('reads a swapped running period to this month, against the same months', () => {
        expect(dates({ period: { year: 'previous' }, compared: { year: 'current' } })).toEqual([
            'after:$y before:$m+1 by:m',
            'after:$y-1 before:$m-11 by:m',
        ]);
        expect(dates({ period: { year: 2024 }, compared: { year: 2026 } })).toEqual([
            'after:2026-01 before:2026-12 by:m',
            'after:2024-01 before:2024-12 by:m',
        ]);
        expect(
            dates({ period: { year: 'previous' }, compared: { year: 'current' } }, 'position')
        ).toEqual(['before:$d+1 by:m', 'before:$m-11 by:m']);
    });

    it('rejects a swapped period that has not started', () => {
        expect(dates({ period: { year: 2025 }, compared: { year: 2027 } })).toBe('future_period');
    });

    it('reports a comparison that overlaps the period, and builds the period', () => {
        expect(dates({ period: { year: 2016 }, compared: { year: 2016 } })).toEqual([
            'on:2016 by:m',
            'comparison_not_earlier',
        ]);
        expect(dates({ period: { year: 'current' }, compared: { year: 2026 } })).toEqual([
            'after:$y before:$m+1 by:m',
            'comparison_not_earlier',
        ]);
    });

    it('reports a comparison of another kind of period', () => {
        expect(dates({ period: { year: 'previous' }, compared: { month: 1 } })).toEqual([
            'on:$y-1 by:m',
            'comparison_kind_mismatch',
        ]);
    });

    it('reads all time to the end of this month, with nothing to compare', () => {
        expect(dates({ period: { span: 'all_time' } })).toEqual(['before:$m+1 by:m', undefined]);
        expect(dates({ period: { span: 'all_time' } }, 'position')).toEqual([
            'before:$d+1 by:m',
            undefined,
        ]);
        expect(dates({ period: { span: 'all_time' }, compareWith: 'year_earlier' })).toEqual([
            'before:$m+1 by:m',
            'comparison_unavailable',
        ]);
    });

    it('reads a balance at the end of a finished period', () => {
        expect(dates({ period: { year: 'previous' } }, 'position')).toEqual([
            'before:$y by:m',
            'before:$y-1 by:m',
        ]);
        expect(dates({ period: { year: 2016 } }, 'position')).toEqual([
            'before:2017-01 by:m',
            'before:2016-01 by:m',
        ]);
        expect(dates({ period: { year: 'current' } }, 'position')).toEqual([
            'before:$d+1 by:m',
            'before:$m-11 by:m',
        ]);
    });

    it('needs a period', () => {
        expect(dates({ period: {} })).toBe('unspecified_period');
    });

    it('describes the months read', () => {
        const built = buildPeriodQuery(
            { period: { quarter: 'current' } },
            { today: TODAY, nature: 'activity' }
        );
        expect(built).toMatchObject({
            ok: true,
            period: { kind: 'quarter', running: true, first: '2026-10', last: '2026-11' },
            comparison: { kind: 'quarter', running: false, first: '2026-07', last: '2026-08' },
        });
    });
});

describe('resolveQueryDates', () => {
    it('resolves bare variables from the Book’s today', () => {
        expect(resolveQueryDates('after:$y before:$m+1 by:m', TODAY)).toEqual({
            first: '2026-01',
            last: '2026-11',
        });
        expect(resolveQueryDates('on:$y-1 by:m', TODAY)).toEqual({
            first: '2025-01',
            last: '2025-12',
        });
        expect(resolveQueryDates('before:$m-11 by:m', TODAY)).toEqual({ last: '2025-11' });
        expect(resolveQueryDates('before:$d+1 by:m', '2026-12-31')).toEqual({
            last: '2026-12',
            beforeDay: '2027-01-01',
        });
    });

    it('resolves ISO years and months', () => {
        expect(resolveQueryDates('on:2023 by:m', TODAY)).toEqual({
            first: '2023-01',
            last: '2023-12',
        });
        expect(resolveQueryDates('after:2016-01 before:2016-04 by:m', TODAY)).toEqual({
            first: '2016-01',
            last: '2016-03',
        });
    });

    it('rejects every other form', () => {
        for (const query of [
            'on:2025-01-31 by:m',
            'after:2025-01-01 before:2026-01-01 by:m',
            'on:01/$y-1 by:m',
            'on:$y-1/01 by:m',
            'on:$y-1-01 by:m',
            'on:$y-1',
            'on:$d by:m',
            'after:$d-14 before:$d+1 by:m',
            'on:$d+1 by:m',
            'on:$y after:$y by:m',
            'before:$m before:$m by:m',
            'after:$m before:$m by:m',
            'on:2025 by:d',
            'by:m',
        ]) {
            expect(() => resolveQueryDates(query, TODAY), query).toThrow();
        }
    });
});

describe('periodRequestOf', () => {
    it('translates relative ids into relative parts', () => {
        expect(periodRequestOf('last_year')).toEqual({
            period: { span: 'year', year: 'previous' },
        });
        expect(periodRequestOf('today', 'year_earlier')).toEqual({
            period: { span: 'now' },
            compareWith: 'year_earlier',
        });
    });

    it('translates dated ids into fixed parts', () => {
        expect(periodRequestOf('2016')).toEqual({ period: { span: 'year', year: 2016 } });
        expect(periodRequestOf('2016-Q3')).toEqual({
            period: { span: 'quarter', year: 2016, quarter: 3 },
        });
        expect(periodRequestOf('2016-02')).toEqual({
            period: { span: 'month', year: 2016, month: 2 },
        });
    });

    it('rejects anything else', () => {
        expect(periodRequestOf('next_year')).toBeUndefined();
        expect(periodRequestOf('2016-13')).toBeUndefined();
    });

    it('translates every relative id into parts that build', () => {
        for (const id of RELATIVE_PERIODS) {
            for (const compareWith of [undefined, 'previous', 'year_earlier'] as const) {
                const request = periodRequestOf(id, compareWith);
                expect(request, id).toBeDefined();
                for (const nature of ['activity', 'position'] as const) {
                    const built = buildPeriodQuery(request!, { today: TODAY, nature });
                    expect(built.ok, id).toBe(true);
                    if (built.ok) {
                        expect(built.comparisonError, id).toBeUndefined();
                        expect(built.comparison === undefined, id).toBe(id === 'all');
                    }
                }
            }
        }
    });
});

/** Edge days of the year, a leap day among them. */
const TODAYS = ['2026-01-01', '2026-03-31', '2026-06-30', '2028-02-29', '2026-11-09', '2026-12-31'];

const SPANS = [undefined, ...PERIOD_SPANS];
const MONTHS: (MonthPart | undefined)[] = [
    undefined,
    'current',
    'previous',
    ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const),
];
const QUARTERS: (QuarterPart | undefined)[] = [undefined, 'current', 'previous', 1, 2, 3, 4];
const COMPARE_WITH = [undefined, 'previous', 'year_earlier'] as const;
const NATURES = ['activity', 'position'] as const;

/** Years relative to today, a past year, and this year and the next written as numbers. */
function yearsOf(today: string, past: number): (YearPart | undefined)[] {
    const year = Number(today.slice(0, 4));
    return [undefined, 'current', 'previous', 'before_previous', past, year, year + 1];
}

/** Bare `$y±n` or `$m±n`, `$d+1` only in `before:`, or ISO `yyyy` or `yyyy-mm`; then `by:m`. */
const DATES_GRAMMAR =
    /^(?:on:(?:\$[ym](?:[+-]\d+)?|\d{4}(?:-\d{2})?)|(?:after:(?:\$[ym](?:[+-]\d+)?|\d{4}(?:-\d{2})?) )?before:(?:\$[ym](?:[+-]\d+)?|\$d\+1|\d{4}(?:-\d{2})?)) by:m$/;

function monthNumber(month: string): number {
    return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function monthCount(dates: PeriodDates): number {
    return monthNumber(dates.last) - monthNumber(dates.first ?? dates.last) + 1;
}

/** What a request built (a comparison, none, or the error), and every invariant it breaks. */
function checkInvariants(
    request: PeriodRequest,
    nature: ReportNature,
    today: string
): { outcome: string; broken: string[] } {
    const built = buildPeriodQuery(request, { today, nature });
    const again = buildPeriodQuery(request, { today, nature });
    const broken: string[] = [];
    const check = (ok: boolean, what: string) => {
        if (!ok) {
            broken.push(what);
        }
    };
    check(JSON.stringify(built) === JSON.stringify(again), 'deterministic');
    if (!built.ok) {
        const { span, year, month, quarter } = request.period;
        const unspecified = [span, year, month, quarter].every(part => part === undefined);
        check((built.reason === 'unspecified_period') === unspecified, built.reason);
        return { outcome: built.reason, broken };
    }
    const thisMonth = today.slice(0, 7);
    const readsAsBuilt = (dates: PeriodDates, what: string) => {
        check(DATES_GRAMMAR.test(dates.dates), `${what} grammar ${dates.dates}`);
        const resolved = resolveQueryDates(dates.dates, today);
        check(resolved.last === dates.last, `${what} last ${dates.dates}`);
        if (nature === 'activity') {
            check(resolved.first === dates.first, `${what} first ${dates.dates}`);
        } else {
            check(resolved.first === undefined, `${what} position after ${dates.dates}`);
        }
        const readsToday = resolved.beforeDay !== undefined;
        check(readsToday === (nature === 'position' && dates.running), `${what} $d+1`);
        check(!readsToday || resolved.beforeDay === addDays(today, 1), `${what} tomorrow`);
    };
    const { period, comparison, comparisonError } = built;
    readsAsBuilt(period, 'period');
    check(period.first === undefined || period.first <= thisMonth, 'period starts after today');
    check(period.running === (period.last === thisMonth), 'running ends this month');
    check(period.last <= thisMonth, 'period ends after this month');
    if (comparison) {
        readsAsBuilt(comparison, 'comparison');
        check(comparison.kind === period.kind, 'comparison kind');
        check(comparison.last < (period.first ?? ''), 'comparison earlier');
        check(monthCount(comparison) === monthCount(period), 'comparison months');
        check(!comparison.running, 'comparison running');
    } else if (comparisonError === undefined) {
        check(period.kind === 'all_time', 'no comparison');
    }
    check(!(comparison && comparisonError), 'comparison and error');
    return { outcome: comparison ? 'compared' : (comparisonError ?? 'none'), broken };
}

/** Every combination of one value of each list. */
function* combinations<T extends unknown[]>(
    ...lists: { [K in keyof T]: readonly T[K][] }
): Generator<T> {
    const [first, ...rest] = lists;
    if (first === undefined) {
        yield [] as unknown as T;
        return;
    }
    for (const value of first) {
        for (const tail of combinations(...rest)) {
            yield [value, ...tail] as T;
        }
    }
}

describe('buildPeriodQuery, every combination of parts', () => {
    for (const today of TODAYS) {
        it(`keeps every invariant of every period on ${today}`, () => {
            const failures: string[] = [];
            const outcomes = new Set<string>();
            let count = 0;
            for (const [span, year, month, quarter, compareWith, nature] of combinations(
                SPANS,
                yearsOf(today, 2016),
                MONTHS,
                QUARTERS,
                COMPARE_WITH,
                NATURES
            )) {
                const request: PeriodRequest = {
                    period: { span, year, month, quarter },
                    compareWith,
                };
                const { outcome, broken } = checkInvariants(request, nature, today);
                count++;
                outcomes.add(outcome);
                failures.push(...broken.map(b => `${JSON.stringify(request)} ${nature}: ${b}`));
            }
            expect(count).toBe(8 * 7 * 15 * 7 * 3 * 2);
            expect(failures.slice(0, 20)).toEqual([]);
            expect([...outcomes].sort()).toEqual([
                'compared',
                'comparison_unavailable',
                'future_period',
                'none',
                'unspecified_period',
            ]);
        });

        it(`keeps every invariant of every comparison on ${today}`, () => {
            const failures: string[] = [];
            const outcomes = new Set<string>();
            for (const [span, year, month, quarter, ...compared] of combinations(
                SPANS,
                [undefined, 'previous', 2016] as const,
                [undefined, 'current', 12] as const,
                [undefined, 3] as const,
                yearsOf(today, 2014),
                MONTHS,
                QUARTERS,
                NATURES
            )) {
                const [comparedYear, comparedMonth, comparedQuarter, nature] = compared;
                const request: PeriodRequest = {
                    period: { span, year, month, quarter },
                    compared: {
                        year: comparedYear,
                        month: comparedMonth,
                        quarter: comparedQuarter,
                    },
                    compareWith: 'year_earlier',
                };
                const { outcome, broken } = checkInvariants(request, nature, today);
                outcomes.add(outcome);
                failures.push(...broken.map(b => `${JSON.stringify(request)} ${nature}: ${b}`));
            }
            expect(failures.slice(0, 20)).toEqual([]);
            expect([...outcomes].sort()).toEqual([
                'compared',
                'comparison_kind_mismatch',
                'comparison_not_earlier',
                'comparison_unavailable',
                // A later comparison that has not started swaps into a future period.
                'future_period',
                'unspecified_period',
            ]);
        });
    }
});

/** The first and last months a dated id names, read from the id alone. */
function monthsOfId(id: string): { first: string; last: string } {
    const [year, rest] = id.split('-');
    const month = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
    if (rest === undefined) {
        return { first: month(1), last: month(12) };
    }
    if (rest.startsWith('Q')) {
        const quarter = Number(rest.slice(1));
        return { first: month(quarter * 3 - 2), last: month(quarter * 3) };
    }
    return { first: month(Number(rest)), last: month(Number(rest)) };
}

describe('periodRequestOf, dated ids', () => {
    it('reads the months the id names, and rejects those not started', () => {
        const failures: string[] = [];
        for (let year = 1990; year <= 2027; year++) {
            const ids = [
                `${year}`,
                ...[1, 2, 3, 4].map(q => `${year}-Q${q}`),
                ...Array.from(
                    { length: 12 },
                    (_, m) => `${year}-${String(m + 1).padStart(2, '0')}`
                ),
            ];
            for (const id of ids) {
                const request = periodRequestOf(id, 'year_earlier');
                const built =
                    request && buildPeriodQuery(request, { today: TODAY, nature: 'activity' });
                const { first, last } = monthsOfId(id);
                if (!built) {
                    failures.push(`${id}: not built`);
                    continue;
                }
                if (first > TODAY.slice(0, 7)) {
                    if (built.ok || built.reason !== 'future_period')
                        failures.push(`${id}: future`);
                    continue;
                }
                const expected = last > TODAY.slice(0, 7) ? TODAY.slice(0, 7) : last;
                if (!built.ok || built.period.first !== first || built.period.last !== expected) {
                    failures.push(`${id}: ${JSON.stringify(built)}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });
});
