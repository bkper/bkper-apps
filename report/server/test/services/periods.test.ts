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
            before: '2026-05-01',
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

    it('resolves the relative periods', () => {
        expect(resolvePeriod('today', { today })).toEqual({
            after: '2026-11-05',
            before: '2026-11-06',
        });
        expect(resolvePeriod('this_month', { today })).toEqual({
            after: '2026-11-01',
            before: '2026-12-01',
        });
        expect(resolvePeriod('last_month', { today })).toEqual({
            after: '2026-10-01',
            before: '2026-11-01',
        });
        expect(resolvePeriod('this_quarter', { today })).toEqual({
            after: '2026-10-01',
            before: '2027-01-01',
        });
        expect(resolvePeriod('this_year', { today })).toEqual({
            after: '2026-01-01',
            before: '2027-01-01',
        });
        expect(resolvePeriod('last_year', { today })).toEqual({
            after: '2025-01-01',
            before: '2026-01-01',
        });
        expect(resolvePeriod('ytd', { today })).toEqual({
            after: '2026-01-01',
            before: '2026-11-06',
        });
        expect(resolvePeriod('last_12_months', { today })).toEqual({
            after: '2025-12-01',
            before: '2026-12-01',
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

    it('resolves all time to everything up to the end of the later of the data or the current month', () => {
        expect(resolvePeriod('all', { today })).toEqual({ before: '2026-12-01' });
        expect(
            resolvePeriod('all', {
                today,
                dataRange: { firstMonth: '2019-04', lastMonth: '2027-02' },
            })
        ).toEqual({
            before: '2027-03-01',
        });
        expect(
            resolvePeriod('all', {
                today,
                dataRange: { firstMonth: '2019-04', lastMonth: '2025-02' },
            })
        ).toEqual({
            before: '2026-12-01',
        });
    });

    it('rejects unknown periods', () => {
        expect(resolvePeriod('next_year', { today })).toBeUndefined();
        expect(resolvePeriod('2026-13', { today })).toBeUndefined();
        expect(resolvePeriod('2026-Q5', { today })).toBeUndefined();
        expect(resolvePeriod('', { today })).toBeUndefined();
    });
});

describe('previousPeriod', () => {
    it('is the same number of months immediately before a month-aligned period', () => {
        expect(previousPeriod({ after: '2026-07-01', before: '2026-10-01' })).toEqual({
            after: '2026-04-01',
            before: '2026-07-01',
        });
        expect(previousPeriod({ after: '2026-03-01', before: '2026-04-01' })).toEqual({
            after: '2026-02-01',
            before: '2026-03-01',
        });
        expect(previousPeriod({ after: '2026-01-01', before: '2027-01-01' })).toEqual({
            after: '2025-01-01',
            before: '2026-01-01',
        });
        expect(previousPeriod({ after: '2025-12-01', before: '2026-12-01' })).toEqual({
            after: '2024-12-01',
            before: '2025-12-01',
        });
    });

    it('is the same number of days immediately before any other period', () => {
        expect(previousPeriod({ after: '2026-11-05', before: '2026-11-06' })).toEqual({
            after: '2026-11-04',
            before: '2026-11-05',
        });
        expect(previousPeriod({ after: '2024-03-01', before: '2024-03-02' })).toEqual({
            after: '2024-02-29',
            before: '2024-03-01',
        });
        // Year to date on 2024-03-01 spans 61 days (Jan 31 + leap Feb 29 + Mar 1).
        expect(previousPeriod({ after: '2024-01-01', before: '2024-03-02' })).toEqual({
            after: '2023-11-01',
            before: '2024-01-01',
        });
    });

    it('has no previous period for all time', () => {
        expect(previousPeriod({ before: '2026-12-01' })).toBeUndefined();
    });
});

describe('defaultPeriod', () => {
    it('reports activity for this year and positions as of today', () => {
        expect(defaultPeriod('activity')).toBe('this_year');
        expect(defaultPeriod('position')).toBe('today');
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
        expect(description('all')).toBe('all time, everything up to 2026-11-30');
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
