import { describe, expect, it } from 'vitest';
import { buildPeriodQuery, resolveQueryDates } from '../../src/services/period-query';
import { addDays, defaultPeriod, isoMonth, todayInTimeZone } from '../../src/services/periods';

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
        const thisMonth = (today: string) => {
            const built = buildPeriodQuery(
                { period: { span: 'month', month: 'current' } },
                { today, nature: 'activity' }
            );
            return built.ok && resolveQueryDates(built.period.dates, today);
        };
        expect(thisMonth(saoPaulo)).toEqual({ first: '2026-03', last: '2026-03' });
        expect(thisMonth(tokyo)).toEqual({ first: '2026-04', last: '2026-04' });
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

describe('early years', () => {
    it('pads months and keeps day arithmetic in the year as written', () => {
        expect(isoMonth(12, 10)).toBe('0012-10');
        expect(isoMonth(2026, 1)).toBe('2026-01');
        expect(addDays('0012-10-31', 1)).toBe('0012-11-01');
        expect(addDays('0099-12-31', 1)).toBe('0100-01-01');
    });
});
