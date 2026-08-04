import { describe, expect, it } from 'bun:test';
import { getAuthBaseUrl } from '../src/auth.js';

describe('web authentication configuration', () => {
    it('uses the current origin only during local development', () => {
        expect(getAuthBaseUrl({ hostname: 'localhost', origin: 'http://localhost:5177' })).toBe(
            'http://localhost:5177'
        );
        expect(
            getAuthBaseUrl({
                hostname: 'exchange-bot.bkper.app',
                origin: 'https://exchange-bot.bkper.app',
            })
        ).toBeUndefined();
    });
});
