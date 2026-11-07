/**
 * How a request writes the names of a Book's groups and accounts: the rules the Worker finds
 * names by and the web client completes them by, in one place so both always agree.
 *
 * - Names and requests compare **folded**: compatibility-decomposed, lowercased, without
 *   combining marks, each run of whitespace one space ({@link foldWithOffsets},
 *   {@link nameKey}).
 * - A name is written only as a **whole**: it starts and ends at a word boundary
 *   (`Intl.Segmenter`, which also splits words in languages written without spaces) or next to
 *   a character that is not a letter, mark or digit ({@link wordBoundaries}).
 * - Names of **one character** are never written ({@link isWritable}): they read as articles and
 *   conjunctions in many languages. `#hashtags` are filters, so names in them do not count
 *   ({@link withoutHashtags}).
 * - **The longest match wins**, and on equal length the one that starts first; a match that
 *   overlaps one already taken is dropped ({@link matchNames}).
 * - **Colliding names**, alike once folded: the one written exactly (case and accents), then a
 *   group over an account, then the first in Book order ({@link pickName}).
 */

/** Letters, marks, digits, `_` and `-` after `#`; punctuation ends a hashtag. */
export const HASHTAG = /#([\p{L}\p{M}\p{N}_-]+)/gu;

/** A Book's group or account, by the kind a name can be of. */
export type NameKind = 'group' | 'account';

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'word' });
const WHITESPACE = /^\s$/u;
const MARKS = /\p{M}+/gu;
const FINAL_SIGMA = /ς/g;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** Whitespace other than single spaces. */
const OTHER_WHITESPACE = /[^\S ]|  /u;
const ONE_CHARACTER = /^.?$/u;
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{M}\p{N}]/gu;

/** Where a text writes a name, and the names alike once folded that it may be. */
export interface NameMatch<T> {
    start: number;
    end: number;
    candidates: T[];
}

/**
 * Where `text` writes the names of `names` (by folded name; `longest` is the longest), as
 * whole names, outside hashtags, the longest first and on equal length the one that starts
 * first, without overlaps; in the order written.
 */
export function matchNames<T>(
    text: string,
    names: ReadonlyMap<string, T[]>,
    longest: number
): NameMatch<T>[] {
    if (names.size === 0) {
        return [];
    }
    const blank = withoutHashtags(text);
    const { folded, at } = foldWithOffsets(blank);
    const boundaries = wordBoundaries(blank);

    const matches: (NameMatch<T> & { length: number })[] = [];
    for (let i = 0; i < boundaries.length; i++) {
        const start = boundaries[i];
        // A run of whitespace folds to one space: a name starts after it, not inside it.
        if (WHITESPACE.test(blank[start] ?? '')) {
            continue;
        }
        for (let j = i + 1; j < boundaries.length; j++) {
            const end = boundaries[j];
            const length = at[end] - at[start];
            if (length > longest) {
                break;
            }
            const candidates = names.get(folded.slice(at[start], at[end]));
            if (candidates) {
                matches.push({ start, end, length, candidates });
            }
        }
    }

    const taken: NameMatch<T>[] = [];
    for (const match of matches.sort((a, b) => b.length - a.length || a.start - b.start)) {
        if (taken.every(other => match.end <= other.start || match.start >= other.end)) {
            taken.push({ start: match.start, end: match.end, candidates: match.candidates });
        }
    }
    return taken.sort((a, b) => a.start - b.start);
}

/** `text` with each hashtag blanked out, so no name is found in it; positions stay. */
export function withoutHashtags(text: string): string {
    return text.replace(HASHTAG, hashtag => ' '.repeat(hashtag.length));
}

/**
 * A name as a request writes it: `written`, its whitespace collapsed and trimmed, to tell an
 * exact match, and `key`, that folded, to compare.
 */
export function nameKey(name: string): { written: string; key: string } {
    const written = collapseWhitespace(name).trim();
    return { written, key: fold(written) };
}

/** Whether a folded name can be written in a request: one character never is. */
export function isWritable(key: string): boolean {
    return !ONE_CHARACTER.test(key);
}

/**
 * The folded text, and where each UTF-16 position of `text` falls in it: compatibility
 * decomposition, lowercase, no combining marks, each run of whitespace one space.
 */
export function foldWithOffsets(text: string): { folded: string; at: number[] } {
    const at: number[] = [];
    let folded = '';
    let index = 0;
    for (const char of text) {
        at[index] = folded.length;
        folded += WHITESPACE.test(char) ? (folded.endsWith(' ') ? '' : ' ') : foldCharacter(char);
        index += char.length;
    }
    at[index] = folded.length;
    return { folded, at };
}

/** Each run of whitespace as one space. */
export function collapseWhitespace(text: string): string {
    return OTHER_WHITESPACE.test(text) ? text.replace(/\s+/gu, ' ') : text;
}

/** Where a whole name may start or end, ascending: word boundaries, and around non-word characters. */
export function wordBoundaries(text: string): number[] {
    const positions = new Set([0, text.length]);
    for (const { index, segment } of SEGMENTER.segment(text)) {
        positions.add(index);
        positions.add(index + segment.length);
    }
    for (const match of text.matchAll(NOT_A_WORD_CHARACTER)) {
        positions.add(match.index);
        positions.add(match.index + match[0].length);
    }
    return [...positions].sort((a, b) => a - b);
}

/**
 * The one of colliding names a request writing `written` (whitespace collapsed) means: written
 * exactly, else a group over an account, else the first in Book order (`order`).
 */
export function pickName<T extends { kind: NameKind; written: string; order: number }>(
    candidates: readonly T[],
    written: string
): T {
    if (candidates.length === 1) {
        return candidates[0];
    }
    const exact = candidates.filter(candidate => candidate.written === written);
    const pool = exact.length > 0 ? exact : candidates;
    return [...pool].sort(
        (a, b) => Number(a.kind === 'account') - Number(b.kind === 'account') || a.order - b.order
    )[0];
}

/** A name folded as {@link foldWithOffsets} folds a request; its whitespace already collapsed. */
function fold(name: string): string {
    if (PRINTABLE_ASCII.test(name)) {
        return name.toLowerCase();
    }
    return foldCharacter(name);
}

/**
 * Folds one character, or a whole text alike: the only lowercase that depends on the next
 * character, Greek final sigma, is read as sigma.
 */
function foldCharacter(text: string): string {
    return text.normalize('NFKD').toLowerCase().replace(MARKS, '').replace(FINAL_SIGMA, 'σ');
}
