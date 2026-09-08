import { expect, test } from 'bun:test';
import { getAccountQuery } from '../../../src/api/services/helper.js';

test('builds the legacy Account query in after-before clause order', () => {
    expect(getAccountQuery('Apple')).toBe("account:'Apple'");
    expect(getAccountQuery('Apple', '2026-04-01')).toBe("account:'Apple' before:2026-04-01");
    expect(getAccountQuery('Apple', '2026-04-01', '2026-02-01')).toBe(
        "account:'Apple' after:2026-02-01 before:2026-04-01"
    );
});
