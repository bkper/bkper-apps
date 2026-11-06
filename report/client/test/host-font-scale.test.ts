import { afterEach, describe, expect, it } from 'vitest';
import { followHostFontScale, readFontScale } from '../src/host-font-scale';

const parent = new EventTarget();
const stranger = new EventTarget();

function message(data: unknown, source: EventTarget = parent): MessageEvent {
    const event = new MessageEvent('message', { data });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

describe('readFontScale', () => {
    it('reads the font scale Bkper sends, within a sensible range', () => {
        expect(readFontScale({ type: 'bkper:font-scale-changed', fontSizeScale: 0.92 })).toBe(0.92);
        expect(readFontScale({ type: 'bkper:font-scale-changed', fontSizeScale: 0.2 })).toBe(
            undefined
        );
        expect(readFontScale({ type: 'bkper:font-scale-changed', fontSizeScale: 3 })).toBe(
            undefined
        );
        expect(readFontScale({ type: 'bkper:font-scale-changed', fontSizeScale: '1' })).toBe(
            undefined
        );
        expect(readFontScale({ type: 'bkper:theme-changed', theme: 'dark' })).toBe(undefined);
        expect(readFontScale(null)).toBe(undefined);
    });
});

describe('followHostFontScale', () => {
    const root = document.createElement('div');
    let stop: (() => void) | undefined;
    afterEach(() => {
        stop?.();
        root.removeAttribute('style');
    });

    function follow(): EventTarget {
        const page = Object.assign(new EventTarget(), { parent });
        stop = followHostFontScale(page, root);
        return page;
    }

    it('scales the interface text as the Bkper page around it does', () => {
        const page = follow();
        page.dispatchEvent(message({ type: 'bkper:font-scale-changed', fontSizeScale: 0.92 }));

        expect(root.style.getPropertyValue('--wa-font-size-scale')).toBe('0.92');
    });

    it('ignores messages from other windows and invalid scales', () => {
        const page = follow();
        page.dispatchEvent(
            message({ type: 'bkper:font-scale-changed', fontSizeScale: 1.5 }, stranger)
        );
        page.dispatchEvent(message({ type: 'bkper:font-scale-changed', fontSizeScale: 9 }));

        expect(root.style.getPropertyValue('--wa-font-size-scale')).toBe('');
    });

    it('follows nothing when it is not embedded', () => {
        const page = new EventTarget();
        stop = followHostFontScale(Object.assign(page, { parent: page }), root);
        page.dispatchEvent(message({ type: 'bkper:font-scale-changed', fontSizeScale: 1.2 }, page));

        expect(root.style.getPropertyValue('--wa-font-size-scale')).toBe('');
    });
});
