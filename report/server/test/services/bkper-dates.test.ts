import { describe, expect, it } from 'vitest';
import { parseBookDate, readDays, readRange } from '../../src/services/bkper-dates';

describe('parseBookDate', () => {
    it('reads years, months and days in each date format', () => {
        expect(parseBookDate('2026', 'dd/MM/yyyy')).toBe('2026-01-01');
        expect(parseBookDate('11/2026', 'dd/MM/yyyy')).toBe('2026-11-01');
        expect(parseBookDate('10/11/2026', 'dd/MM/yyyy')).toBe('2026-11-10');
        expect(parseBookDate('11/2026', 'MM/dd/yyyy')).toBe('2026-11-01');
        expect(parseBookDate('11/10/2026', 'MM/dd/yyyy')).toBe('2026-11-10');
        expect(parseBookDate('2026/11', 'yyyy/MM/dd')).toBe('2026-11-01');
        expect(parseBookDate('2026/11/10', 'yyyy/MM/dd')).toBe('2026-11-10');
    });

    it('rejects what is not a date in the format', () => {
        for (const [text, pattern] of [
            ['31/12/2026', 'MM/dd/yyyy'],
            ['2026/11', 'dd/MM/yyyy'],
            ['30/02/2026', 'dd/MM/yyyy'],
            ['$y-1', 'yyyy/MM/dd'],
            ['', 'dd/MM/yyyy'],
            ['1/2/3/4', 'dd/MM/yyyy'],
        ] as const) {
            expect(() => parseBookDate(text, pattern), text).toThrow();
        }
    });
});

describe('readRange', () => {
    it('reads the bounds Bkper writes', () => {
        expect(readRange(' after:2026 before:2026/12 by:m', 'yyyy/MM/dd')).toEqual({
            after: '2026-01-01',
            before: '2026-12-01',
            by: 'm',
        });
        expect(readRange(' before:10/11/2026 by:m', 'dd/MM/yyyy')).toEqual({
            before: '2026-11-10',
            by: 'm',
        });
    });

    it('rejects other terms and repeated bounds', () => {
        expect(() => readRange('on:2026 by:m', 'dd/MM/yyyy')).toThrow();
        expect(() => readRange('before:2026 before:2027', 'dd/MM/yyyy')).toThrow();
    });
});

describe('readDays', () => {
    it('reads the days Bkper labels a query with, in each date format', () => {
        const labels = {
            'dd/MM/yyyy': ['01/01/2026', '30/11/2026'],
            'MM/dd/yyyy': ['01/01/2026', '11/30/2026'],
            'yyyy/MM/dd': ['2026/01/01', '2026/11/30'],
        } as const;
        for (const [pattern, [begin, end]] of Object.entries(labels)) {
            expect(readDays({ rangeBeginLabel: begin, rangeEndLabel: end }, pattern)).toEqual({
                after: '2026-01-01',
                before: '2026-12-01',
            });
        }
    });

    it('reads from the start of the Book without a first day', () => {
        expect(
            readDays({ rangeBeginLabel: '', rangeEndLabel: '09/11/2026' }, 'dd/MM/yyyy')
        ).toEqual({ before: '2026-11-10' });
        expect(readDays({ rangeEndLabel: '11/09/2026' }, 'MM/dd/yyyy')).toEqual({
            before: '2026-11-10',
        });
    });

    it('reads nothing without a known format or whole days', () => {
        expect(readDays({ rangeEndLabel: '30/11/2026' }, undefined)).toBeUndefined();
        expect(readDays({ rangeEndLabel: '30/11/2026' }, 'dd-MM-yyyy')).toBeUndefined();
        expect(readDays({}, 'dd/MM/yyyy')).toBeUndefined();
        expect(readDays({ rangeEndLabel: '11/2026' }, 'dd/MM/yyyy')).toBeUndefined();
        expect(readDays({ rangeEndLabel: '30/11/2026' }, 'MM/dd/yyyy')).toBeUndefined();
        expect(
            readDays({ rangeBeginLabel: '2026', rangeEndLabel: '30/11/2026' }, 'dd/MM/yyyy')
        ).toBeUndefined();
    });
});
