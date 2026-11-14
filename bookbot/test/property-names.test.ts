import { describe, expect, it } from 'bun:test';
import * as constants from '../src/constants.js';

describe('Bookbot property names', () => {
    it('keeps every new property key within Bkper\'s 30 characters, in normalized form, under bookbot_', () => {
        const newKeys = Object.entries(constants)
            .filter(([name]) => name.startsWith('BOOKBOT_'))
            .map(([, value]) => value as string);

        expect(newKeys.length).toBe(5);
        for (const key of newKeys) {
            expect(key.length).toBeLessThanOrEqual(30);
            expect(key).toMatch(/^bookbot_[a-z0-9]+(_[a-z0-9]+)*_?$/);
        }
    });
});
