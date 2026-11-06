import { LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import {
    VisualViewportController,
    type VisualViewportSource,
} from '../../../src/components/report-app/visual-viewport';

/** A visual viewport whose size and offset a test sets, as the on-screen keyboard would. */
class FakeViewport extends EventTarget implements VisualViewportSource {
    height = 800;
    offsetTop = 0;
    scale = 1;

    change(values: Partial<Pick<FakeViewport, 'height' | 'offsetTop' | 'scale'>>): void {
        Object.assign(this, values);
        this.dispatchEvent(new Event('resize'));
    }
}

const viewport = new FakeViewport();

class ViewportHost extends LitElement {
    readonly viewport = new VisualViewportController(this, viewport);
}
customElements.define('viewport-host', ViewportHost);

function mount(): ViewportHost {
    const host = new ViewportHost();
    document.body.append(host);
    return host;
}

const height = (host: HTMLElement) => host.style.getPropertyValue('--report-viewport-height');
const top = (host: HTMLElement) => host.style.getPropertyValue('--report-viewport-top');

describe('VisualViewportController', () => {
    afterEach(() => {
        document.body.replaceChildren();
        viewport.change({ height: 800, offsetTop: 0, scale: 1 });
    });

    it('sizes its host to the visible part of the page, above the on-screen keyboard', () => {
        const host = mount();
        expect(height(host)).toBe('800px');
        expect(top(host)).toBe('0px');

        viewport.change({ height: 460, offsetTop: 120 });
        expect(height(host)).toBe('460px');
        expect(top(host)).toBe('120px');

        viewport.dispatchEvent(new Event('scroll'));
        expect(top(host)).toBe('120px');
    });

    it('leaves the page size to CSS while the person zooms in', () => {
        const host = mount();
        viewport.change({ height: 400, scale: 2 });

        expect(height(host)).toBe('');
        expect(top(host)).toBe('');
    });

    it('stops following the viewport once disconnected', () => {
        const host = mount();
        host.remove();
        viewport.change({ height: 300 });

        expect(height(host)).toBe('800px');
    });
});
