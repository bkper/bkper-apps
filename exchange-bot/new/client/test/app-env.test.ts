import { afterEach, describe, expect, it } from 'bun:test';
import { appEnv } from '../src/app-env.js';

const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');

afterEach(() => {
    if (originalLocation) {
        Object.defineProperty(self, 'location', originalLocation);
    } else {
        Reflect.deleteProperty(self, 'location');
    }
});

describe('App environment', () => {
    it('reads a search parameter from the current URL', () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://exchange-bot.bkper.app/?bookId=book-id&embedded=true',
            },
        });

        expect(appEnv.getSearchParam('bookId')).toBe('book-id');
        expect(appEnv.getSearchParam('embedded')).toBe('true');
        expect(appEnv.getSearchParam('missing')).toBeNull();
    });
});
