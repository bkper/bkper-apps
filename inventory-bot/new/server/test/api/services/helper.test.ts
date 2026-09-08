import { expect, test } from 'bun:test';
import { getAccountQuery, getTimeRange, parseDate } from '../../../src/api/services/helper.js';

test('builds the legacy Account query in after-before clause order', () => {
    expect(getAccountQuery('Apple')).toBe("account:'Apple'");
    expect(getAccountQuery('Apple', '2026-04-01')).toBe("account:'Apple' before:2026-04-01");
    expect(getAccountQuery('Apple', '2026-04-01', '2026-02-01')).toBe(
        "account:'Apple' after:2026-02-01 before:2026-04-01"
    );
});

test('preserves the legacy calculation date and month-range helpers', () => {
    const date = parseDate('2026-03-15');

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(13);
    expect(getTimeRange(2)).toBe(2 * 30 * 24 * 60 * 60 * 1000);
});
