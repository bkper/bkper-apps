import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/events.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { App } from 'bkper-js';
import { AppHelpView } from '../../../src/components/app-help/app-help-view.js';

type HandleSelect = (this: AppHelpView, event: WaSelectEvent) => void;

const handleSelect = Reflect.get(AppHelpView.prototype, 'handleSelect') as HandleSelect;
const originalOpen = Object.getOwnPropertyDescriptor(globalThis, 'open');

afterEach(() => {
    if (originalOpen) {
        Object.defineProperty(globalThis, 'open', originalOpen);
    } else {
        Reflect.deleteProperty(globalThis, 'open');
    }
});

describe('App help view', () => {
    it('opens the app and repository help links in a new tab', () => {
        const openedUrls: string[] = [];
        let focusCount = 0;
        Object.defineProperty(globalThis, 'open', {
            configurable: true,
            value: (url: string, target: string) => {
                expect(target).toBe('_blank');
                openedUrls.push(url);
                return {
                    focus: () => {
                        focusCount++;
                    },
                };
            },
        });
        const view = new AppHelpView();
        view.app = new App({
            website: 'https://example.com/global-exchange-bot',
            repoUrl: 'https://github.com/example/global-exchange-bot',
        });

        handleSelect.call(view, {
            detail: { item: { value: 'website' } },
        } as unknown as WaSelectEvent);
        handleSelect.call(view, {
            detail: { item: { value: 'repository' } },
        } as unknown as WaSelectEvent);

        expect(openedUrls).toEqual([
            'https://example.com/global-exchange-bot',
            'https://github.com/example/global-exchange-bot',
        ]);
        expect(focusCount).toBe(2);
    });
});
