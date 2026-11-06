/** The message Bkper sends an embedded page when its text scale changes. */
export const FONT_SCALE_MESSAGE = 'bkper:font-scale-changed';

/** Scales outside this range are not a text size anyone reads at. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

/** The text scale of a Bkper font-scale message, or `undefined` for anything else. */
export function readFontScale(data: unknown): number | undefined {
    if (typeof data !== 'object' || data === null) return undefined;
    if (!('type' in data) || data.type !== FONT_SCALE_MESSAGE) return undefined;
    if (!('fontSizeScale' in data)) return undefined;
    const scale = data.fontSizeScale;
    return typeof scale === 'number' && scale >= MIN_SCALE && scale <= MAX_SCALE
        ? scale
        : undefined;
}

/** The page the app runs in: the browser's `window`, or a double in tests. */
export interface FontScalePage extends EventTarget {
    readonly parent: unknown;
}

/**
 * Embedded in Bkper, scale the interface text as the Bkper page around it does
 * (`--wa-font-size-scale` on `root`), from the font-scale messages of the parent window only.
 * The light or dark theme follows the parent through the first-paint theme script. Returns a
 * function that stops following.
 */
export function followHostFontScale(
    page: FontScalePage,
    root: { readonly style: Pick<CSSStyleDeclaration, 'setProperty'> }
): () => void {
    const listener = (event: Event) => {
        if (!(event instanceof MessageEvent) || event.source !== page.parent) return;
        const scale = readFontScale(event.data);
        if (scale !== undefined) root.style.setProperty('--wa-font-size-scale', String(scale));
    };
    if (page.parent === page) return () => undefined;
    page.addEventListener('message', listener);
    return () => page.removeEventListener('message', listener);
}
