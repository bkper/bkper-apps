import { afterEach, describe, expect, it } from 'bun:test';
import { appEnv } from '../src/app-env.js';

const originalLocation = Object.getOwnPropertyDescriptor(self, 'location');
const originalTop = Object.getOwnPropertyDescriptor(self, 'top');

afterEach(() => {
    if (originalLocation) {
        Object.defineProperty(self, 'location', originalLocation);
    } else {
        Reflect.deleteProperty(self, 'location');
    }
    if (originalTop) {
        Object.defineProperty(self, 'top', originalTop);
    } else {
        Reflect.deleteProperty(self, 'top');
    }
});

describe('App environment', () => {
    it('builds the main Book transactions URL', () => {
        expect(appEnv.getBookUrl('book-id')).toBe('https://bkper.app/books/book-id/transactions');
    });

    it('reads a search parameter from the current URL', () => {
        Object.defineProperty(self, 'location', {
            configurable: true,
            value: {
                href: 'https://exchange-bot.bkper.app/?bookId=book-id',
            },
        });

        expect(appEnv.getSearchParam('bookId')).toBe('book-id');
        expect(appEnv.getSearchParam('missing')).toBeNull();
    });

    it('detects when the app is embedded in an iframe', () => {
        Object.defineProperty(self, 'top', {
            configurable: true,
            value: {},
        });

        expect(appEnv.isEmbedded()).toBe(true);
    });

    it('detects when the app is running at the top level', () => {
        Object.defineProperty(self, 'top', {
            configurable: true,
            value: self,
        });

        expect(appEnv.isEmbedded()).toBe(false);
    });
});
