import type { LitElement, ReactiveController } from 'lit';

/** A mouse or pen drag starts once the pointer moves this far, so a plain click still clicks. */
export const START_DISTANCE = 4;
/** A finger held this long, moving less than `TOUCH_SLOP`, picks a chip up; a swipe scrolls. */
export const LONG_PRESS_MS = 350;
export const TOUCH_SLOP = 8;
/** How close to the row's ends it scrolls, and its fastest speed per frame, in CSS pixels. */
const EDGE_ZONE = 48;
const EDGE_SPEED = 12;

export type Direction = 'ltr' | 'rtl';

/** A chip's left and right edges in the row's content, as laid out (without transforms). */
export interface Span {
    readonly start: number;
    readonly end: number;
}

/**
 * Where a chip dragged from `from` lands, as its index among the other chips: past every other
 * chip whose center its own center has passed, in the row's reading direction.
 */
export function dropIndex(
    spans: readonly Span[],
    from: number,
    center: number,
    dir: Direction
): number {
    let index = 0;
    spans.forEach((span, at) => {
        if (at === from) return;
        const middle = (span.start + span.end) / 2;
        if (dir === 'ltr' ? middle < center : middle > center) index++;
    });
    return index;
}

/**
 * The offset of each chip that opens a gap at `to` for the chip dragged from `from`: those
 * between its old and new places slide over by `distance` (its width and one gap).
 */
export function slideOffsets(
    count: number,
    from: number,
    to: number,
    distance: number,
    dir: Direction
): number[] {
    const sign = dir === 'ltr' ? 1 : -1;
    return Array.from({ length: count }, (_, at) => {
        if (from < to && at > from && at <= to) return -distance * sign;
        if (to < from && at >= to && at < from) return distance * sign;
        return 0;
    });
}

/** The id a chip dragged from `from` and landing at `to` moves before (`null`: the end). */
export function beforeOf(
    ids: readonly string[],
    from: number,
    to: number
): string | null | undefined {
    if (from === to) return undefined;
    return ids.filter((_, at) => at !== from)[to] ?? null;
}

/**
 * Where to draw a lifted chip whose left edge the pointer puts at `left`: whole inside the row,
 * so at either end it shows over the gap there. A chip wider than the row shows its start.
 */
export function inside(
    left: number,
    width: number,
    box: { left: number; right: number },
    dir: Direction = 'ltr'
): number {
    const last = box.right - width;
    if (last < box.left) return dir === 'ltr' ? box.left : last;
    return Math.min(Math.max(left, box.left), last);
}

export function pastDistance(dx: number, dy: number, distance: number): boolean {
    return Math.hypot(dx, dy) >= distance;
}

/** Whether the pointer left the row above or below by more than the row's own height. */
export function leftRow(y: number, box: { top: number; bottom: number }): boolean {
    const margin = box.bottom - box.top;
    return y < box.top - margin || y > box.bottom + margin;
}

/**
 * How far to scroll the row this frame (negative: left): faster the closer the pointer is to
 * an end, and only toward an end it has moved to since the chip was picked up (`moved`).
 */
export function edgeScroll(x: number, box: { left: number; right: number }, moved: number): number {
    const zone = Math.min(EDGE_ZONE, (box.right - box.left) / 4);
    const depth = (distance: number) => Math.min(1, Math.max(0, (zone - distance) / zone));
    if (moved > 0 && x > box.right - zone) return Math.ceil(EDGE_SPEED * depth(box.right - x));
    if (moved < 0 && x < box.left + zone) return -Math.ceil(EDGE_SPEED * depth(x - box.left));
    return 0;
}

export interface ShelfDragOptions {
    /** The scrolling row the chips are in. */
    row(): HTMLElement | null | undefined;
    /** The chips in the row's order, each with its prompt's id in `data-id`. */
    chips(): HTMLElement[];
    /** The ids of the prompts the shelf shows, in its order (what the next render draws). */
    ids(): readonly string[];
    /** Whether the person may move prompts now (their role, and no change pending). */
    canMove(): boolean;
    /** Move a prompt before `before` (`null`: the end); settles once the shelf has its order. */
    move(id: string, before: string | null): Promise<void>;
}

interface Press {
    readonly pointerId: number;
    readonly touch: boolean;
    readonly chip: HTMLElement;
    readonly startX: number;
    readonly startY: number;
    x: number;
    y: number;
    timer?: ReturnType<typeof setTimeout>;
    drag?: Drag;
}

/** What a lifted chip needs each frame, measured once when it is picked up. */
interface Drag {
    readonly row: HTMLElement;
    readonly box: DOMRect;
    readonly chips: readonly HTMLElement[];
    readonly ids: readonly string[];
    readonly spans: readonly Span[];
    readonly from: number;
    /** Where chips show in the row: its box within its padding. */
    readonly bounds: { readonly left: number; readonly right: number };
    /** The lifted chip's left edge on screen, its width and center in the row, when picked up. */
    readonly left: number;
    readonly width: number;
    readonly center: number;
    readonly distance: number;
    readonly dir: Direction;
    readonly scroll: number;
    to: number;
    /** The pointer left the row: the chip shows back in its place, where it would return. */
    away: boolean;
    frame?: number;
}

/** The theme's durations: a landing chip is beside its gap; others may travel a chip's width. */
type TransitionToken = '--wa-transition-fast' | '--wa-transition-normal';

/** A chip as shown before a render: on screen, in layout, and whether it was being dragged. */
interface Shown {
    readonly left: number;
    readonly layout: number;
    readonly dragged: boolean;
}

const PROMPT = 'wa-button.saved-prompt';
const CHIP = 'wa-button-group[data-id]';
const translate = (x: number) => (x ? `translate3d(${x}px, 0, 0)` : '');

/**
 * Drag a saved prompt along the shelf to reorder it. A mouse or pen drags after a few pixels; a
 * finger after a long press, so a swipe still scrolls the row. The picked chip follows the
 * pointer and the others slide aside, opening a gap its width where it will land. Escape, or
 * leaving the row above or below, puts it back. Dropping it elsewhere moves it on the shelf.
 *
 * While dragging only transforms change, a frame at a time, and the host does not render; the
 * drop renders once, and the chips then slide from where they were shown to their places (FLIP),
 * also when a failed move restores the order. Reduced motion jumps instead of sliding.
 */
export class ShelfDrag implements ReactiveController {
    private press?: Press;
    /** From a drop until its move settles, every render slides the chips it moves. */
    private settling = false;
    /** The chips' positions as shown just before a render, to slide from after it. */
    private shown?: Map<HTMLElement, Shown>;
    /** The lifted chip, kept lifted until it has landed. */
    private lifted?: HTMLElement;
    /** The next render lands a dropped chip, already beside its gap: quickly. */
    private landing = false;
    private suppressClick = false;

    constructor(
        private readonly host: LitElement,
        private readonly options: ShelfDragOptions
    ) {
        host.addController(this);
    }

    /** Whether a chip is being dragged, or its drop is settling: the row stays where it is. */
    get active(): boolean {
        return this.press?.drag !== undefined || this.settling;
    }

    hostConnected(): void {
        const root = this.host.renderRoot;
        root.addEventListener('pointerdown', this.onPointerDown);
        root.addEventListener('click', this.onClick, { capture: true });
        root.addEventListener('contextmenu', this.onContextMenu);
        // Not passive: a lifted chip keeps the finger from scrolling the row or the page.
        root.addEventListener('touchmove', this.onTouchMove, { passive: false });
    }

    hostDisconnected(): void {
        const root = this.host.renderRoot;
        root.removeEventListener('pointerdown', this.onPointerDown);
        root.removeEventListener('click', this.onClick, { capture: true });
        root.removeEventListener('contextmenu', this.onContextMenu);
        root.removeEventListener('touchmove', this.onTouchMove);
        this.end();
        const chips = this.options.chips();
        this.clear(chips);
        for (const chip of chips) for (const animation of chip.getAnimations()) animation.cancel();
        this.settling = false;
        this.lifted?.removeAttribute('data-lifted');
        this.lifted = undefined;
    }

    hostUpdate(): void {
        const drag = this.press?.drag;
        // The shelf changed under a lifted chip (a reload, another Book): put it back.
        const stale = drag !== undefined && !same(drag.ids, this.options.ids());
        if (stale) this.end();
        if ((stale || this.settling) && !this.shown) this.shown = this.capture();
    }

    hostUpdated(): void {
        const shown = this.shown;
        const landing = this.landing;
        this.shown = undefined;
        this.landing = false;
        if (shown) this.play(shown, landing ? '--wa-transition-fast' : '--wa-transition-normal');
    }

    private onPointerDown = (event: Event) => {
        if (!(event instanceof PointerEvent) || !event.isPrimary) return;
        const touch = event.pointerType === 'touch';
        // One chip at a time: not while another is still landing.
        if (this.press || this.settling || this.lifted) return;
        if (!touch && event.button !== 0) return;
        this.suppressClick = false;
        const path = event.composedPath();
        const prompt = path.find(
            (target): target is Element => target instanceof Element && target.matches(PROMPT)
        );
        const chip = prompt?.closest<HTMLElement>(CHIP);
        if (!chip || !this.options.canMove() || this.options.chips().length < 2) return;
        this.press = {
            pointerId: event.pointerId,
            touch,
            chip,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            timer: touch ? setTimeout(() => this.lift(), LONG_PRESS_MS) : undefined,
        };
        addEventListener('pointermove', this.onPointerMove);
        addEventListener('pointerup', this.onPointerUp);
        addEventListener('pointercancel', this.onPointerCancel);
    };

    private onPointerMove = (event: PointerEvent) => {
        const press = this.press;
        if (!press || event.pointerId !== press.pointerId) return;
        press.x = event.clientX;
        press.y = event.clientY;
        if (press.drag) return this.schedule(press.drag);
        const dx = press.x - press.startX;
        const dy = press.y - press.startY;
        // A finger that moves before the long press is a swipe: the row scrolls.
        if (press.touch) {
            if (pastDistance(dx, dy, TOUCH_SLOP)) this.end();
        } else if (pastDistance(dx, dy, START_DISTANCE)) this.lift();
    };

    private onPointerUp = (event: PointerEvent) => {
        if (event.pointerId !== this.press?.pointerId) return;
        if (this.press.drag) this.drop();
        else this.end();
    };

    private onPointerCancel = (event: PointerEvent) => {
        if (event.pointerId === this.press?.pointerId) this.cancel(false);
    };

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !this.press?.drag) return;
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
    };

    private onBlur = () => this.cancel(false);

    /** The click that ends a drag is no click on the prompt. */
    private onClick = (event: Event) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
    };

    /** A long press is the drag's, not the browser's menu. */
    private onContextMenu = (event: Event) => {
        if (this.press?.touch) event.preventDefault();
    };

    private onTouchMove = (event: Event) => {
        if (this.press?.drag && event.cancelable) event.preventDefault();
    };

    /** Pick the pressed chip up, measuring once what each frame needs. */
    private lift(): void {
        const press = this.press;
        if (!press || press.drag) return;
        clearTimeout(press.timer);
        const row = this.options.row();
        const chips = this.options.chips();
        const from = chips.indexOf(press.chip);
        if (!row || from === -1 || chips.length < 2 || !this.options.canMove()) return this.end();
        const box = row.getBoundingClientRect();
        const scroll = row.scrollLeft;
        const spans = chips.map(chip => {
            const rect = chip.getBoundingClientRect();
            return { start: rect.left - box.left + scroll, end: rect.right - box.left + scroll };
        });
        const style = getComputedStyle(row);
        const gap = parseFloat(style.columnGap) || 0;
        const own = spans[from];
        press.drag = {
            row,
            box,
            chips,
            ids: chips.map(chip => chip.dataset.id ?? ''),
            spans,
            from,
            bounds: {
                left: box.left + (parseFloat(style.paddingLeft) || 0),
                right: box.right - (parseFloat(style.paddingRight) || 0),
            },
            left: own.start - scroll + box.left,
            width: own.end - own.start,
            center: (own.start + own.end) / 2,
            distance: own.end - own.start + gap,
            dir: style.direction === 'rtl' ? 'rtl' : 'ltr',
            scroll,
            to: from,
            away: false,
        };
        // A captured mouse keeps dragging outside the panel; a finger is captured already.
        if (!press.touch) press.chip.setPointerCapture(press.pointerId);
        row.toggleAttribute('data-dragging', true);
        press.chip.toggleAttribute('data-lifted', true);
        this.lifted = press.chip;
        addEventListener('keydown', this.onKeyDown, { capture: true });
        addEventListener('blur', this.onBlur);
        this.schedule(press.drag);
    }

    private schedule(drag: Drag): void {
        drag.frame ??= requestAnimationFrame(() => {
            drag.frame = undefined;
            this.frame(drag);
        });
    }

    /** One frame of a drag: scroll near an end, follow the pointer, open the gap. */
    private frame(drag: Drag): void {
        const press = this.press;
        if (!press || press.drag !== drag) return;
        const away = leftRow(press.y, drag.box);
        if (away !== drag.away) {
            drag.away = away;
            press.chip.toggleAttribute('data-away', away);
        }
        const speed = away ? 0 : edgeScroll(press.x, drag.box, press.x - press.startX);
        const scrolled = drag.row.scrollLeft;
        if (speed) drag.row.scrollLeft += speed;
        const moved = press.x - press.startX;
        const content = drag.row.scrollLeft - drag.scroll;
        // Drawn whole inside the row; where it lands follows the pointer, even past an end.
        const drawn = inside(drag.left + moved, drag.width, drag.bounds, drag.dir) - drag.left;
        press.chip.style.transform = translate((away ? 0 : drawn) + content);
        const to = away
            ? drag.from
            : dropIndex(drag.spans, drag.from, drag.center + moved + content, drag.dir);
        if (to !== drag.to) {
            drag.to = to;
            const offsets = slideOffsets(drag.chips.length, drag.from, to, drag.distance, drag.dir);
            drag.chips.forEach((chip, at) => {
                if (at !== drag.from) chip.style.transform = translate(offsets[at]);
            });
        }
        // Keep scrolling while the pointer rests near an end, until the row reaches it.
        if (speed && drag.row.scrollLeft !== scrolled) this.schedule(drag);
    }

    /** Drop the chip: move it where the gap is, or put it back. */
    private drop(): void {
        const drag = this.press?.drag;
        if (!drag) return;
        // A frame not yet drawn may have moved the gap; drop where the pointer is now.
        if (drag.frame !== undefined) {
            cancelAnimationFrame(drag.frame);
            drag.frame = undefined;
            this.frame(drag);
        }
        const before = beforeOf(drag.ids, drag.from, drag.to);
        const id = drag.ids[drag.from];
        this.end();
        this.eatClick();
        if (before === undefined || !this.options.canMove()) return this.settleNow();
        this.landing = true;
        void this.settle(this.options.move(id, before));
    }

    /** Put a lifted chip back where it was. */
    private cancel(pressed = true): void {
        const press = this.press;
        this.end();
        if (!press?.drag) return;
        this.settleNow();
        if (!pressed) return;
        // Put back while still pressed: releasing it later is no click on the prompt. A
        // release elsewhere is never heard, so the next press forgets it.
        const types = ['pointerup', 'pointercancel', 'pointerdown'] as const;
        const release = (event: PointerEvent) => {
            if (event.pointerId !== press.pointerId) return;
            for (const type of types) removeEventListener(type, release, { capture: true });
            if (event.type === 'pointerup') this.eatClick();
        };
        for (const type of types) addEventListener(type, release, { capture: true });
    }

    /** The click, if any, comes with this pointerup; never let it eat a later one. */
    private eatClick(): void {
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false));
    }

    /** Slide every render's chips from where they were shown until the move settles. */
    private async settle(moved: Promise<void>): Promise<void> {
        this.settling = true;
        try {
            await moved;
            await this.host.updateComplete;
        } finally {
            this.settling = false;
            // The shelf did not render (nothing changed): put the chips back from here.
            if (this.lifted?.style.transform) this.settleNow();
        }
    }

    /** Slide the chips back to their places, with no render. */
    private settleNow(): void {
        this.landing = false;
        this.play(this.capture(), '--wa-transition-normal');
    }

    /** Stop listening to the press and the drag; the chips keep their transforms. */
    private end(): void {
        const press = this.press;
        if (!press) return;
        this.press = undefined;
        clearTimeout(press.timer);
        if (press.drag?.frame !== undefined) cancelAnimationFrame(press.drag.frame);
        if (press.chip.hasPointerCapture?.(press.pointerId)) {
            press.chip.releasePointerCapture(press.pointerId);
        }
        removeEventListener('pointermove', this.onPointerMove);
        removeEventListener('pointerup', this.onPointerUp);
        removeEventListener('pointercancel', this.onPointerCancel);
        removeEventListener('keydown', this.onKeyDown, { capture: true });
        removeEventListener('blur', this.onBlur);
    }

    /**
     * Where each chip shows now (its transform and any slide still running included) and where
     * it is laid out, then clear the transforms, so the chips can slide from there.
     */
    private capture(): Map<HTMLElement, Shown> {
        const chips = this.options.chips();
        const shown = new Map(
            chips.map(chip => [
                chip,
                {
                    left: chip.getBoundingClientRect().left,
                    layout: chip.offsetLeft,
                    dragged: chip.style.transform !== '' || chip.hasAttribute('data-away'),
                },
            ])
        );
        this.clear(chips);
        return shown;
    }

    private clear(chips: readonly HTMLElement[]): void {
        // Without the row's transitions, clearing the transforms slides nothing by itself.
        this.options.row()?.removeAttribute('data-dragging');
        for (const chip of chips) {
            chip.style.transform = '';
            chip.removeAttribute('data-away');
        }
    }

    /** Slide each chip from where it was shown to where it is (FLIP), then set it down. */
    private play(shown: Map<HTMLElement, Shown>, speed: TransitionToken): void {
        const chips = this.options.chips().filter(chip => {
            const from = shown.get(chip);
            // A chip still in its place keeps sliding as it was (a render after the drop).
            return from && (from.dragged || Math.abs(chip.offsetLeft - from.layout) >= 1);
        });
        for (const chip of chips) for (const animation of chip.getAnimations()) animation.cancel();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const duration = parseFloat(getComputedStyle(this.host).getPropertyValue(speed)) || 150;
            // Every position first, then every animation, so the browser lays out once.
            const slides = chips.flatMap(chip => {
                const dx = (shown.get(chip)?.left ?? 0) - chip.getBoundingClientRect().left;
                return Math.abs(dx) < 0.5 ? [] : [{ chip, dx }];
            });
            for (const { chip, dx } of slides) {
                chip.animate([{ transform: translate(dx) }, { transform: 'none' }], {
                    duration,
                    easing: 'ease-out',
                });
            }
        }
        this.setDown();
    }

    /** Once the lifted chip has landed, set it down, without waiting for the shelf's answer. */
    private setDown(): void {
        const lifted = this.lifted;
        if (!lifted || this.press?.chip === lifted) return;
        const landing = lifted.getAnimations();
        if (landing.length) {
            void Promise.allSettled(landing.map(animation => animation.finished)).then(() =>
                this.setDown()
            );
            return;
        }
        lifted.removeAttribute('data-lifted');
        this.lifted = undefined;
    }
}

function same(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, at) => id === b[at]);
}
