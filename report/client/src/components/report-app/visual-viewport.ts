import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** The part of `window.visualViewport` this follows: the browser's, or a double in tests. */
export interface VisualViewportSource extends EventTarget {
    readonly height: number;
    readonly offsetTop: number;
    readonly scale: number;
}

/**
 * Keeps its host on the visible part of the page: on phones, the on-screen keyboard covers the
 * bottom of the page without resizing it, so the host gets the visual viewport's height and
 * top (`--report-viewport-height`, `--report-viewport-top`) and the input at its bottom stays
 * above the keyboard. While the person zooms in, the page keeps its own size.
 */
export class VisualViewportController implements ReactiveController {
    constructor(
        private readonly host: ReactiveControllerHost & HTMLElement,
        private readonly viewport: VisualViewportSource | undefined = window.visualViewport ??
            undefined
    ) {
        host.addController(this);
    }

    hostConnected(): void {
        this.viewport?.addEventListener('resize', this.follow);
        this.viewport?.addEventListener('scroll', this.follow);
        this.follow();
    }

    hostDisconnected(): void {
        this.viewport?.removeEventListener('resize', this.follow);
        this.viewport?.removeEventListener('scroll', this.follow);
    }

    private readonly follow = () => {
        const viewport = this.viewport;
        const style = this.host.style;
        if (!viewport || viewport.scale !== 1) {
            style.removeProperty('--report-viewport-height');
            style.removeProperty('--report-viewport-top');
            return;
        }
        style.setProperty('--report-viewport-height', `${viewport.height}px`);
        style.setProperty('--report-viewport-top', `${viewport.offsetTop}px`);
    };
}
