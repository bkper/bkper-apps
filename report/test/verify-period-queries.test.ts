import { describe, expect, it } from 'vitest';
import {
    expectedRead,
    readMismatches,
    type BkperRead,
} from '../scripts/verify-period-queries/bkper-read';
import { PERIOD_SAMPLES, sampleQueries } from '../scripts/verify-period-queries/samples';
import { PERIOD_SPANS, buildPeriodQuery } from '../server/src/services/period-query';

function months(...list: string[]): BkperRead['balances'] {
    return list.map(month => ({
        year: Number(month.slice(0, 4)),
        month: Number(month.slice(5, 7)),
        day: 0,
    }));
}

describe('readMismatches', () => {
    it('accepts a running year to date as a year-first Book reads it', () => {
        const expected = expectedRead({ first: '2026-01', last: '2026-11' });
        const read: BkperRead = {
            range: ' after:2026 before:2026/12 by:m',
            rangeBeginLabel: '2026/01/01',
            rangeEndLabel: '2026/11/30',
            periodicity: 'MONTHLY',
            balances: months(
                ...Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
            ),
        };
        expect(readMismatches(expected, read, 'yyyy/MM/dd')).toEqual([]);
    });

    it('accepts a balance now, with the months up to this one', () => {
        const expected = expectedRead({ last: '2026-11', beforeDay: '2026-11-10' });
        const read: BkperRead = {
            range: ' before:10/11/2026 by:m',
            rangeBeginLabel: '',
            rangeEndLabel: '09/11/2026',
            periodicity: 'MONTHLY',
            balances: months('2015-02', '2015-04', '2026-11'),
        };
        expect(readMismatches(expected, read, 'dd/MM/yyyy')).toEqual([]);
    });

    it('accepts a balance at the end of a month with the next month listed, but no later', () => {
        const expected = expectedRead({ last: '2016-12' });
        const read: BkperRead = {
            range: ' before:01/2017 by:m',
            rangeBeginLabel: '',
            rangeEndLabel: '12/31/2016',
            periodicity: 'MONTHLY',
            balances: months('2016-11', '2016-12', '2017-01'),
        };
        expect(readMismatches(expected, read, 'MM/dd/yyyy')).toEqual([]);
        read.balances = months('2016-12', '2017-01', '2017-02');
        expect(readMismatches(expected, read, 'MM/dd/yyyy')).toEqual([
            'months after 2017-01: 2017-02',
        ]);
    });

    it('reports a whole year read for a month, by day, and with missing months', () => {
        const expected = expectedRead({ first: '2025-01', last: '2025-01' });
        const read: BkperRead = {
            range: ' after:2025 before:2026 by:m',
            rangeBeginLabel: '01/01/2025',
            rangeEndLabel: '31/12/2025',
            periodicity: 'DAILY',
            balances: [{ year: 2025, month: 1, day: 3 }],
        };
        expect(readMismatches(expected, read, 'dd/MM/yyyy')).toEqual([
            'periodicity DAILY, expected MONTHLY',
            'range before 2026-01-01, expected 2025-02-01',
            'end label 2025-12-31, expected 2025-01-31',
            '1 balances by day',
        ]);
        read.periodicity = 'MONTHLY';
        read.range = ' after:01/2025 before:02/2025 by:m';
        read.rangeEndLabel = '31/01/2025';
        read.balances = [];
        expect(readMismatches(expected, read, 'dd/MM/yyyy')).toEqual(['months , expected 2025-01']);
    });

    it('reports a range it cannot read', () => {
        const expected = expectedRead({ first: '2025-01', last: '2025-12' });
        expect(
            readMismatches(
                expected,
                { range: 'on:2025', rangeEndLabel: '2025-12-31', balances: [] },
                'dd/MM/yyyy'
            )
        ).toHaveLength(5);
    });
});

describe('sampleQueries', () => {
    const TODAYS = ['2026-01-01', '2026-03-31', '2026-11-09', '2026-12-31', '2028-02-29'];

    it('builds every sample, compared when it asks, on edge days of the year', () => {
        for (const today of TODAYS) {
            expect(() => sampleQueries(today), today).not.toThrow();
        }
    });

    it('covers every span, both natures, and every kind of comparison', () => {
        const spans = new Set(
            PERIOD_SAMPLES.map(({ request }) => {
                const built = buildPeriodQuery(request, {
                    today: '2026-11-09',
                    nature: 'activity',
                });
                return built.ok ? built.period.kind : undefined;
            })
        );
        expect([...spans].sort()).toEqual([...PERIOD_SPANS].sort());
        const requests = PERIOD_SAMPLES.map(sample => sample.request);
        expect(requests.some(r => r.compareWith === 'year_earlier')).toBe(true);
        expect(requests.some(r => r.compared !== undefined)).toBe(true);
        const queries = sampleQueries('2026-11-09');
        expect(new Set(queries.map(q => q.nature))).toEqual(new Set(['activity', 'position']));
        expect(queries.some(q => q.dates === 'before:$d+1 by:m')).toBe(true);
        expect(new Set(queries.map(q => `${q.nature} ${q.dates}`)).size).toBe(queries.length);
    });
});
