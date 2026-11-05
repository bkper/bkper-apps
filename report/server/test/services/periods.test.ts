import { describe, expect, it } from 'vitest';
import {
    MAX_PERIOD_OPTIONS,
    buildPeriodOptions,
    defaultPeriod,
    isPeriodId,
    previousPeriod,
    resolvePeriod,
    todayInTimeZone,
} from '../../src/services/periods';

describe('todayInTimeZone', () => {
    const lateMarch31Utc = new Date('2026-03-31T23:30:00Z');

    it('uses the calendar date of the Book time zone', () => {
        expect(todayInTimeZone(lateMarch31Utc, 'America/Sao_Paulo')).toBe('2026-03-31');
        expect(todayInTimeZone(lateMarch31Utc, 'Asia/Tokyo')).toBe('2026-04-01');
        expect(todayInTimeZone(lateMarch31Utc, 'UTC')).toBe('2026-03-31');
    });

    it('crosses the year boundary by time zone', () => {
        const newYearUtc = new Date('2026-01-01T02:00:00Z');
        expect(todayInTimeZone(newYearUtc, 'America/New_York')).toBe('2025-12-31');
        expect(todayInTimeZone(newYearUtc, 'Europe/Berlin')).toBe('2026-01-01');
    });

    it('defaults to UTC when the Book has no time zone', () => {
        expect(todayInTimeZone(lateMarch31Utc, undefined)).toBe('2026-03-31');
    });

    it('makes the same instant fall in different months, and so in different periods', () => {
        const saoPaulo = todayInTimeZone(lateMarch31Utc, 'America/Sao_Paulo');
        const tokyo = todayInTimeZone(lateMarch31Utc, 'Asia/Tokyo');
        expect(resolvePeriod('this_month', { today: saoPaulo })).toEqual({
            after: '2026-03-01',
            before: '2026-04-01',
        });
        expect(resolvePeriod('this_month', { today: tokyo })).toEqual({
            after: '2026-04-01',
            before: '2026-04-02',
        });
    });
});

describe('resolvePeriod', () => {
    const today = '2026-11-05';

    it('resolves last quarter on 2026-11-05 to Jul 1 – Oct 1', () => {
        expect(resolvePeriod('last_quarter', { today })).toEqual({
            after: '2026-07-01',
            before: '2026-10-01',
        });
    });

    it('ends the current periods at tomorrow, so they include today and exclude future dates', () => {
        expect(resolvePeriod('today', { today })).toEqual({
            after: '2026-11-05',
            before: '2026-11-06',
        });
        expect(resolvePeriod('this_month', { today })).toEqual({
            after: '2026-11-01',
            before: '2026-11-06',
        });
        expect(resolvePeriod('this_quarter', { today })).toEqual({
            after: '2026-10-01',
            before: '2026-11-06',
        });
        expect(resolvePeriod('this_year', { today })).toEqual({
            after: '2026-01-01',
            before: '2026-11-06',
        });
        expect(resolvePeriod('ytd', { today })).toEqual({
            after: '2026-01-01',
            before: '2026-11-06',
        });
        expect(resolvePeriod('last_12_months', { today })).toEqual({
            after: '2025-12-01',
            before: '2026-11-06',
        });
        expect(resolvePeriod('all', { today })).toEqual({ before: '2026-11-06' });
    });

    it('resolves the past relative periods to whole calendar periods', () => {
        expect(resolvePeriod('last_month', { today })).toEqual({
            after: '2026-10-01',
            before: '2026-11-01',
        });
        expect(resolvePeriod('last_year', { today })).toEqual({
            after: '2025-01-01',
            before: '2026-01-01',
        });
    });

    it('ends March before April 1, whatever day of March it is', () => {
        expect(resolvePeriod('2026-03', { today })).toEqual({
            after: '2026-03-01',
            before: '2026-04-01',
        });
        expect(resolvePeriod('this_month', { today: '2026-03-31' })).toEqual({
            after: '2026-03-01',
            before: '2026-04-01',
        });
        expect(resolvePeriod('last_month', { today: '2026-04-20' })).toEqual({
            after: '2026-03-01',
            before: '2026-04-01',
        });
        expect(resolvePeriod('2026-Q1', { today })).toEqual({
            after: '2026-01-01',
            before: '2026-04-01',
        });
    });

    it('resolves years, quarters and months, across year ends', () => {
        expect(resolvePeriod('2024', { today })).toEqual({
            after: '2024-01-01',
            before: '2025-01-01',
        });
        expect(resolvePeriod('2025-Q4', { today })).toEqual({
            after: '2025-10-01',
            before: '2026-01-01',
        });
        expect(resolvePeriod('2025-12', { today })).toEqual({
            after: '2025-12-01',
            before: '2026-01-01',
        });
    });

    it('resolves relative periods across year ends', () => {
        expect(resolvePeriod('last_month', { today: '2026-01-15' })).toEqual({
            after: '2025-12-01',
            before: '2026-01-01',
        });
        expect(resolvePeriod('last_quarter', { today: '2026-02-10' })).toEqual({
            after: '2025-10-01',
            before: '2026-01-01',
        });
        expect(resolvePeriod('ytd', { today: '2026-12-31' })).toEqual({
            after: '2026-01-01',
            before: '2027-01-01',
        });
        expect(resolvePeriod('last_12_months', { today: '2026-01-31' })).toEqual({
            after: '2025-02-01',
            before: '2026-02-01',
        });
        expect(resolvePeriod('this_year', { today: '2026-12-31' })).toEqual({
            after: '2026-01-01',
            before: '2027-01-01',
        });
    });

    it('handles leap years', () => {
        expect(resolvePeriod('2024-02', { today })).toEqual({
            after: '2024-02-01',
            before: '2024-03-01',
        });
        expect(resolvePeriod('today', { today: '2024-02-28' })).toEqual({
            after: '2024-02-28',
            before: '2024-02-29',
        });
        expect(resolvePeriod('today', { today: '2024-02-29' })).toEqual({
            after: '2024-02-29',
            before: '2024-03-01',
        });
        expect(resolvePeriod('ytd', { today: '2024-02-29' })).toEqual({
            after: '2024-01-01',
            before: '2024-03-01',
        });
        expect(resolvePeriod('today', { today: '2025-02-28' })).toEqual({
            after: '2025-02-28',
            before: '2025-03-01',
        });
    });

    it('resolves all time to everything up to today, whatever the data range', () => {
        expect(
            resolvePeriod('all', {
                today,
                dataRange: { firstMonth: '2019-04', lastMonth: '2027-02' },
            })
        ).toEqual({ before: '2026-11-06' });
        expect(
            resolvePeriod('all', {
                today,
                dataRange: { firstMonth: '2010-10', lastMonth: '2011-12' },
            })
        ).toEqual({ before: '2026-11-06' });
    });

    it('rejects unknown periods', () => {
        expect(resolvePeriod('next_year', { today })).toBeUndefined();
        expect(resolvePeriod('2026-13', { today })).toBeUndefined();
        expect(resolvePeriod('2026-Q5', { today })).toBeUndefined();
        expect(resolvePeriod('', { today })).toBeUndefined();
    });
});

describe('previousPeriod', () => {
    const today = '2026-11-05';
    const previous = (id: string, day = today) => previousPeriod(id, 'activity', { today: day });

    it('is the previous calendar month, quarter or year of a whole period', () => {
        expect(previous('last_month')).toEqual({ after: '2026-09-01', before: '2026-10-01' });
        expect(previous('2026-03')).toEqual({ after: '2026-02-01', before: '2026-03-01' });
        expect(previous('2026-01')).toEqual({ after: '2025-12-01', before: '2026-01-01' });
        expect(previous('last_quarter')).toEqual({ after: '2026-04-01', before: '2026-07-01' });
        expect(previous('2026-Q1')).toEqual({ after: '2025-10-01', before: '2026-01-01' });
        expect(previous('last_year')).toEqual({ after: '2024-01-01', before: '2025-01-01' });
        expect(previous('2024')).toEqual({ after: '2023-01-01', before: '2024-01-01' });
    });

    it('is the same span one period back for the current periods', () => {
        expect(previous('this_month')).toEqual({ after: '2026-10-01', before: '2026-10-06' });
        expect(previous('this_quarter')).toEqual({ after: '2026-07-01', before: '2026-08-06' });
        expect(previous('this_year')).toEqual({ after: '2025-01-01', before: '2025-11-06' });
        expect(previous('ytd')).toEqual({ after: '2025-01-01', before: '2025-11-06' });
        expect(previous('last_12_months')).toEqual({
            after: '2024-12-01',
            before: '2025-11-06',
        });
        expect(previous('today')).toEqual({ after: '2026-11-04', before: '2026-11-05' });
    });

    it('clamps the same day to the end of a shorter month', () => {
        expect(previous('this_month', '2026-03-31')).toEqual({
            after: '2026-02-01',
            before: '2026-03-01',
        });
        expect(previous('this_month', '2024-03-30')).toEqual({
            after: '2024-02-01',
            before: '2024-03-01',
        });
        expect(previous('this_quarter', '2026-05-31')).toEqual({
            after: '2026-01-01',
            before: '2026-03-01',
        });
        expect(previous('this_year', '2024-02-29')).toEqual({
            after: '2023-01-01',
            before: '2023-03-01',
        });
        expect(previous('this_month', '2026-01-15')).toEqual({
            after: '2025-12-01',
            before: '2025-12-16',
        });
        expect(previous('this_quarter', '2026-01-31')).toEqual({
            after: '2025-10-01',
            before: '2025-11-01',
        });
    });

    it('has no previous period for all time or an unknown id', () => {
        expect(previous('all')).toBeUndefined();
        expect(previous('next_year')).toBeUndefined();
    });

    it('compares positions at the end of the previous period', () => {
        const position = (id: string) => previousPeriod(id, 'position', { today });
        expect(position('today')).toEqual({ before: '2026-11-01' });
        expect(position('this_month')).toEqual({ before: '2026-11-01' });
        expect(position('last_month')).toEqual({ before: '2026-10-01' });
        expect(position('this_quarter')).toEqual({ before: '2026-10-01' });
        expect(position('last_quarter')).toEqual({ before: '2026-07-01' });
        expect(position('this_year')).toEqual({ before: '2026-01-01' });
        expect(position('ytd')).toEqual({ before: '2026-01-01' });
        expect(position('last_12_months')).toEqual({ before: '2025-12-01' });
        expect(position('2024')).toEqual({ before: '2024-01-01' });
        expect(position('2025-Q4')).toEqual({ before: '2025-10-01' });
        expect(position('all')).toBeUndefined();
    });
});

describe('defaultPeriod', () => {
    const today = '2026-11-05';

    it('reports activity for this year and positions as of today', () => {
        expect(defaultPeriod({ nature: 'activity', trend: false, today })).toBe('this_year');
        expect(defaultPeriod({ nature: 'position', trend: false, today })).toBe('today');
        expect(
            defaultPeriod({ nature: 'activity', trend: false, today, lastActiveMonth: '2026-01' })
        ).toBe('this_year');
    });

    it('reports activity for the last year with movements when this year has none', () => {
        expect(
            defaultPeriod({ nature: 'activity', trend: false, today, lastActiveMonth: '2025-12' })
        ).toBe('2025');
        expect(
            defaultPeriod({ nature: 'activity', trend: false, today, lastActiveMonth: '2011-03' })
        ).toBe('2011');
    });

    it('keeps positions as of today, whenever the last movement was', () => {
        expect(
            defaultPeriod({ nature: 'position', trend: false, today, lastActiveMonth: '2019-07' })
        ).toBe('today');
    });

    it('shows a trend over the last 12 months when they have movements', () => {
        for (const nature of ['activity', 'position'] as const) {
            expect(defaultPeriod({ nature, trend: true, today })).toBe('last_12_months');
            expect(defaultPeriod({ nature, trend: true, today, lastActiveMonth: '2025-12' })).toBe(
                'last_12_months'
            );
        }
    });

    it('shows a trend over the last year with movements when the last 12 months have none', () => {
        expect(
            defaultPeriod({ nature: 'activity', trend: true, today, lastActiveMonth: '2025-11' })
        ).toBe('2025');
        expect(
            defaultPeriod({ nature: 'position', trend: true, today, lastActiveMonth: '2019-07' })
        ).toBe('2019');
    });
});

describe('buildPeriodOptions', () => {
    const today = '2026-11-05';
    const ids = (options: { id: string }[]) => options.map(option => option.id);

    it('offers the relative periods even without data', () => {
        expect(ids(buildPeriodOptions({ today }))).toEqual([
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
        ]);
    });

    it('adds each year, quarter and month within the data range, most recent first', () => {
        const options = buildPeriodOptions({
            today,
            dataRange: { firstMonth: '2025-11', lastMonth: '2026-02' },
        });
        expect(ids(options).slice(10)).toEqual([
            '2026',
            '2025',
            '2026-Q1',
            '2025-Q4',
            '2026-02',
            '2026-01',
            '2025-12',
            '2025-11',
        ]);
    });

    it('describes each option with its dates, end inclusive', () => {
        const options = buildPeriodOptions({
            today,
            dataRange: { firstMonth: '2026-02', lastMonth: '2026-02' },
        });
        const description = (id: string) => options.find(option => option.id === id)?.description;
        expect(description('last_quarter')).toBe('last quarter, 2026-07-01 to 2026-09-30');
        expect(description('today')).toBe('today, 2026-11-05');
        expect(description('this_month')).toBe('this month, 2026-11-01 to 2026-11-05');
        expect(description('all')).toBe('all time, everything up to 2026-11-05');
        expect(description('2026')).toBe('year 2026, 2026-01-01 to 2026-12-31');
        expect(description('2026-Q1')).toBe('2026 Q1, 2026-01-01 to 2026-03-31');
        expect(description('2026-02')).toBe('February 2026, 2026-02-01 to 2026-02-28');
    });

    it('offers only valid, resolvable period ids', () => {
        const options = buildPeriodOptions({
            today,
            dataRange: { firstMonth: '2020-01', lastMonth: '2026-11' },
        });
        for (const option of options) {
            expect(isPeriodId(option.id)).toBe(true);
            expect(resolvePeriod(option.id, { today })).toBeDefined();
        }
        expect(new Set(ids(options)).size).toBe(options.length);
    });

    it('caps long histories at the option limit, keeping every year and the most recent quarters and months', () => {
        const options = buildPeriodOptions({
            today,
            dataRange: { firstMonth: '2000-01', lastMonth: '2026-11' },
        });
        const optionIds = ids(options);
        expect(options).toHaveLength(MAX_PERIOD_OPTIONS);
        expect(MAX_PERIOD_OPTIONS).toBe(255);
        expect(optionIds).toContain('2000');
        expect(optionIds).toContain('2026-11');
        expect(optionIds).toContain('2026-Q4');
        expect(optionIds).not.toContain('2000-01');
        expect(optionIds).not.toContain('2000-Q1');

        const months = optionIds.filter(id => /^\d{4}-\d{2}$/.test(id));
        const quarters = optionIds.filter(id => /^\d{4}-Q\d$/.test(id));
        expect(months[0]).toBe('2026-11');
        expect(quarters[0]).toBe('2026-Q4');
        // The kept months are contiguous from the most recent one.
        expect(months).toEqual([...months].sort().reverse());
    });
});

describe('isPeriodId', () => {
    it('accepts relative ids, years, quarters and months', () => {
        for (const id of ['today', 'ytd', 'all', '2024', '2024-Q2', '2024-09']) {
            expect(isPeriodId(id)).toBe(true);
        }
    });

    it('rejects anything else', () => {
        for (const id of [
            '',
            'yesterday',
            '24',
            '2024-Q0',
            '2024-00',
            '2024-1',
            '2024-09-01',
            ' 2024',
        ]) {
            expect(isPeriodId(id)).toBe(false);
        }
    });
});
