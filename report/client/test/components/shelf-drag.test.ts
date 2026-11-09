import { describe, expect, it } from 'vitest';
import {
    LONG_PRESS_MS,
    START_DISTANCE,
    TOUCH_SLOP,
    beforeOf,
    dropIndex,
    edgeScroll,
    inside,
    leftRow,
    pastDistance,
    slideOffsets,
    type Span,
} from '../../src/components/shelf-drag';

/** Chips of these widths in a row with this gap, from the row's left edge, as laid out in `dir`. */
function row(widths: number[], gap: number, dir: 'ltr' | 'rtl', width = 1000): Span[] {
    let at = dir === 'ltr' ? 0 : width;
    return widths.map(size => {
        const span = dir === 'ltr' ? { start: at, end: at + size } : { start: at - size, end: at };
        at = dir === 'ltr' ? at + size + gap : at - size - gap;
        return span;
    });
}

const center = (span: Span) => (span.start + span.end) / 2;

describe('Where a dragged chip lands', () => {
    const ltr = row([100, 100, 100, 100], 8, 'ltr');
    const rtl = row([100, 100, 100, 100], 8, 'rtl');

    it('stays in its own place until its center passes a neighbor’s center', () => {
        expect(dropIndex(ltr, 1, center(ltr[1]), 'ltr')).toBe(1);
        expect(dropIndex(ltr, 1, center(ltr[2]) - 1, 'ltr')).toBe(1);
        expect(dropIndex(ltr, 1, center(ltr[2]) + 1, 'ltr')).toBe(2);
        expect(dropIndex(ltr, 1, center(ltr[0]) - 1, 'ltr')).toBe(0);
    });

    it('goes first or last past the row’s ends', () => {
        expect(dropIndex(ltr, 2, -500, 'ltr')).toBe(0);
        expect(dropIndex(ltr, 0, 5000, 'ltr')).toBe(3);
    });

    it('reads the row from the right in right-to-left languages', () => {
        expect(dropIndex(rtl, 1, center(rtl[1]), 'rtl')).toBe(1);
        // Moving right in RTL is earlier in the order.
        expect(dropIndex(rtl, 1, center(rtl[0]) + 1, 'rtl')).toBe(0);
        expect(dropIndex(rtl, 1, center(rtl[2]) - 1, 'rtl')).toBe(2);
        expect(dropIndex(rtl, 0, -500, 'rtl')).toBe(3);
    });

    it('compares with neighbors of any width by their centers', () => {
        const spans = row([300, 50, 120], 8, 'ltr');
        expect(dropIndex(spans, 0, center(spans[1]) - 1, 'ltr')).toBe(0);
        expect(dropIndex(spans, 0, center(spans[1]) + 1, 'ltr')).toBe(1);
        expect(dropIndex(spans, 0, center(spans[2]) + 1, 'ltr')).toBe(2);
    });
});

describe('The gap the others open', () => {
    it('slides the chips between the old and new place by the dragged chip’s width and a gap', () => {
        expect(slideOffsets(4, 0, 2, 108, 'ltr')).toEqual([0, -108, -108, 0]);
        expect(slideOffsets(4, 3, 1, 108, 'ltr')).toEqual([0, 108, 108, 0]);
        expect(slideOffsets(4, 2, 2, 108, 'ltr')).toEqual([0, 0, 0, 0]);
    });

    it('slides the other way in right-to-left languages', () => {
        expect(slideOffsets(4, 0, 2, 108, 'rtl')).toEqual([0, 108, 108, 0]);
        expect(slideOffsets(4, 3, 1, 108, 'rtl')).toEqual([0, -108, -108, 0]);
    });

    it('opens a gap exactly the dragged chip’s width where it lands', () => {
        for (const dir of ['ltr', 'rtl'] as const) {
            const widths = [80, 140, 60, 200, 90];
            const gap = 8;
            const spans = row(widths, gap, dir);
            for (let from = 0; from < widths.length; from++) {
                for (let to = 0; to < widths.length; to++) {
                    const offsets = slideOffsets(widths.length, from, to, widths[from] + gap, dir);
                    const moved = spans
                        .map((span, index) => ({
                            start: span.start + offsets[index],
                            end: span.end + offsets[index],
                        }))
                        .filter((_, index) => index !== from)
                        .sort((a, b) => a.start - b.start);
                    const holes = moved
                        .slice(1)
                        .map((span, index) => span.start - moved[index].end)
                        .filter(hole => hole > gap);
                    if (from === to) expect(offsets.every(offset => offset === 0)).toBe(true);
                    // The hole between neighbors, or at an end, is the dragged chip and its gaps.
                    const left = moved[0].start - Math.min(...spans.map(span => span.start));
                    const right = Math.max(...spans.map(span => span.end)) - moved.at(-1)!.end;
                    const edge = [left, right].filter(hole => hole > 0);
                    expect([...holes, ...edge.map(hole => hole + gap)]).toEqual([
                        widths[from] + 2 * gap,
                    ]);
                }
            }
        }
    });
});

describe('Where the lifted chip is drawn', () => {
    const box = { left: 10, right: 310 };

    it('follows the pointer inside the row', () => {
        expect(inside(100, 80, box)).toBe(100);
    });

    it('stays whole at the row’s ends, over the gap there, however far the pointer goes', () => {
        expect(inside(-50, 80, box)).toBe(10);
        expect(inside(290, 80, box)).toBe(230);
    });

    it('keeps the start of a chip wider than the row in view', () => {
        expect(inside(40, 400, box, 'ltr')).toBe(10);
        expect(inside(40, 400, box, 'rtl')).toBe(-90);
    });
});

describe('The id a drop moves before', () => {
    const ids = ['a', 'b', 'c', 'd'];

    it('is the chip that follows the landing place among the others, or the end', () => {
        expect(beforeOf(ids, 0, 2)).toBe('d');
        expect(beforeOf(ids, 0, 3)).toBeNull();
        expect(beforeOf(ids, 3, 0)).toBe('a');
        expect(beforeOf(ids, 2, 1)).toBe('b');
    });

    it('is undefined when the chip lands where it was', () => {
        expect(beforeOf(ids, 1, 1)).toBeUndefined();
    });
});

describe('Starting, cancelling and scrolling a drag', () => {
    it('starts a mouse drag after a few pixels, and a long press only if the finger stays', () => {
        expect(START_DISTANCE).toBe(4);
        expect(pastDistance(3, 2, START_DISTANCE)).toBe(false);
        expect(pastDistance(3, 3, START_DISTANCE)).toBe(true);
        expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(300);
        expect(pastDistance(0, TOUCH_SLOP, TOUCH_SLOP)).toBe(true);
    });

    it('cancels once the pointer leaves the row above or below by more than its height', () => {
        const box = { top: 100, bottom: 140 };
        expect(leftRow(120, box)).toBe(false);
        expect(leftRow(100 - 40, box)).toBe(false);
        expect(leftRow(100 - 41, box)).toBe(true);
        expect(leftRow(140 + 41, box)).toBe(true);
    });

    it('scrolls toward an end the pointer moved to, faster closer to it', () => {
        const box = { left: 0, right: 400 };
        expect(edgeScroll(200, box, 50)).toBe(0);
        expect(edgeScroll(390, box, 50)).toBeGreaterThan(0);
        expect(edgeScroll(398, box, 50)).toBeGreaterThan(edgeScroll(370, box, 50));
        expect(edgeScroll(5, box, -50)).toBeLessThan(0);
        expect(edgeScroll(500, box, 50)).toBe(edgeScroll(400, box, 50));
    });

    it('does not scroll toward the end a chip was picked up next to, until it moves there', () => {
        const box = { left: 0, right: 400 };
        expect(edgeScroll(395, box, 0)).toBe(0);
        expect(edgeScroll(395, box, -10)).toBe(0);
        expect(edgeScroll(5, box, 10)).toBe(0);
    });
});
