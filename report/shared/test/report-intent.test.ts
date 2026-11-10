import { describe, expect, it } from 'vitest';
import {
    RELATIVE_PERIODS,
    intentWithParts,
    periodIdOf,
    periodRequestOf,
    validComparedParts,
    validPeriodParts,
} from '../src/report-intent';

describe('period ids and parts', () => {
    it('finds the id of exactly the parts an id translates into', () => {
        for (const id of [...RELATIVE_PERIODS, '2017', '2017-Q4', '2017-03', '1999-12']) {
            for (const compareWith of [undefined, 'year_earlier'] as const) {
                const request = periodRequestOf(id, compareWith);
                expect(request, id).toBeDefined();
                expect(periodIdOf(request!), id).toBe(id);
            }
        }
    });

    it('finds no id for parts no id says', () => {
        expect(periodIdOf({ period: { year: 'previous' } })).toBeUndefined();
        expect(periodIdOf({ period: { span: 'month', month: 3 } })).toBeUndefined();
        expect(periodIdOf({ period: { span: 'quarter', year: 'previous', quarter: 3 } })).toBe(
            undefined
        );
        expect(
            periodIdOf({ period: { span: 'year', year: 'previous' }, compared: { year: 2023 } })
        ).toBeUndefined();
        // All time has no comparison: an id could not say one.
        expect(
            periodIdOf({ period: { span: 'all_time' }, compareWith: 'year_earlier' })
        ).toBeUndefined();
    });

    it('validates the parts of a period and of a comparison', () => {
        expect(validPeriodParts({ span: 'year', year: 'previous' })).toBe(true);
        expect(validPeriodParts({ span: 'all_time' })).toBe(true);
        expect(validPeriodParts({ month: 12, year: 2999 })).toBe(true);
        expect(validPeriodParts({})).toBe(false);
        expect(validPeriodParts({ year: 999 })).toBe(false);
        expect(validPeriodParts({ month: 13 as 1 })).toBe(false);
        expect(validPeriodParts({ quarter: 0 as 1 })).toBe(false);
        expect(validComparedParts({ quarter: 'previous' })).toBe(true);
        expect(validComparedParts({})).toBe(false);
    });

    it('translates the period id of an older intent, with its comparison', () => {
        expect(
            intentWithParts({
                root: 'a',
                period: 'last_year',
                compareWith: 'year_earlier',
                monthly: false,
            })
        ).toEqual({
            root: 'a',
            period: { span: 'year', year: 'previous' },
            compareWith: 'year_earlier',
            monthly: false,
        });
        expect(
            intentWithParts({ root: 'a', period: 'all', compareWith: 'previous', monthly: true })
        ).toEqual({ root: 'a', period: { span: 'all_time' }, monthly: true });
        expect(intentWithParts({ root: 'a', period: 'next_year', monthly: true })).toBeUndefined();
        const parts = {
            root: 'a',
            period: { year: 2023 },
            compared: { year: 2021 },
            monthly: true,
        };
        expect(intentWithParts(parts)).toEqual(parts);
    });
});
