/**
 * Colors of report charts and tables, from the Bkper type color tokens of `@bkper/web-design`
 * (the palette of Bkper's own charts), so they follow the light or dark theme.
 */
import type { TypeColor } from './spec-types.js';

export type Tone = 'low' | 'medium' | 'high';

/** A tone of a type color, as a CSS color. */
export function typeColor(color: TypeColor, tone: Tone): string {
    return `var(--bkper-color-${color}-${tone})`;
}

/** A color pushed into the background, for the parts a highlight is not about. */
export function faded(color: string): string {
    return `color-mix(in srgb, ${color} 40%, transparent)`;
}

/** A light fill of a color, inside an outline or under a line, so what it fills stays visible. */
export function hollow(color: string): string {
    return `color-mix(in srgb, ${color} 22%, transparent)`;
}

/** How far the lightest shade goes, from high (0) through medium (0.5) to low (1). */
const LIGHTEST_SHADE = 0.85;

/**
 * One color per item, like Bkper charts: items of the same type color get shades from strong
 * to light, in order, so neighbouring slices stay apart.
 */
export function shades(colors: TypeColor[]): string[] {
    const counts = new Map<TypeColor, number>();
    colors.forEach(color => counts.set(color, (counts.get(color) ?? 0) + 1));
    const seen = new Map<TypeColor, number>();
    return colors.map(color => {
        const index = seen.get(color) ?? 0;
        seen.set(color, index + 1);
        const count = counts.get(color) ?? 1;
        return shade(color, count === 1 ? 0 : (index / (count - 1)) * LIGHTEST_SHADE);
    });
}

function shade(color: TypeColor, position: number): string {
    if (position === 0) {
        return typeColor(color, 'high');
    }
    const [from, to, weight]: [Tone, Tone, number] =
        position <= 0.5
            ? ['high', 'medium', 1 - position * 2]
            : ['medium', 'low', 2 - position * 2];
    const percent = Math.round(weight * 100);
    return `color-mix(in srgb, ${typeColor(color, from)} ${percent}%, ${typeColor(color, to)})`;
}
