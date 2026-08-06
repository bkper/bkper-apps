import { describe, expect, it } from 'bun:test';
import { Utils } from '../src/utils.js';

describe('Utils', () => {
    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
