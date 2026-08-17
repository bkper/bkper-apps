import { afterEach, describe, expect, it } from 'bun:test';
import { appEnvironment } from '../src/app/app-environment';

const originalTop = Object.getOwnPropertyDescriptor(window, 'top');

afterEach(() => {
    if (originalTop) {
        Object.defineProperty(window, 'top', originalTop);
    }
});

describe('app environment', () => {
    it('detects when the app is embedded in an iframe', () => {
        Object.defineProperty(window, 'top', {
            configurable: true,
            value: {},
        });

        expect(appEnvironment.isEmbedded()).toBe(true);
    });

    it('detects when the app is running at the top level', () => {
        Object.defineProperty(window, 'top', {
            configurable: true,
            value: window,
        });

        expect(appEnvironment.isEmbedded()).toBe(false);
    });
});
