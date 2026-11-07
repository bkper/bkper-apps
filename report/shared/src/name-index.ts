/**
 * Completing the names of a Book's groups and accounts as a request is typed, from an index
 * built once per list of names, with no network: by the rules the Worker finds names by
 * (`report-shared/names`), so a name completed is the name the report is of.
 *
 * - The text completed is the end of the request at the caret, from a word boundary on, once it
 *   is {@link MIN_COMPLETION_LENGTH} characters, folded as names are; the caret must end a word,
 *   and `#hashtags` complete nothing.
 * - A name completes it when the name starts with it, or one of the name's words does: no
 *   fuzzy matches, no matches inside a word.
 * - Ranked: the most of the text completed (so "credit ca" completes Credit Card over Cash),
 *   then names that start with it before names with a word that does, then the shortest, then
 *   Book order; at most {@link MAX_COMPLETIONS}.
 * - Only names the Worker then reads as themselves: never one character; of names written alike,
 *   the one it reads (a group, then the first in Book order); and each completion is checked
 *   against the request it makes ({@link matchNames}), so a name a longer one would swallow,
 *   such as Card after "credit" when the Book has Credit Card, is not offered. A name the request
 *   already writes exactly is not offered again; one written another way (case, accents) is.
 */
import {
    collapseWhitespace,
    foldWithOffsets,
    isWritable,
    matchNames,
    nameKey,
    pickName,
    withoutHashtags,
    wordBoundaries,
    type NameKind,
} from './names.js';

/** The most names offered at once. */
export const MAX_COMPLETIONS = 5;

/** The characters typed, folded, before a text is completed. */
export const MIN_COMPLETION_LENGTH = 2;

/** A group or account of a Book, in Book order, as the app's API lists it. */
export interface BookName {
    id: string;
    /** The name as the Book writes it: what a completion inserts. */
    name: string;
    kind: NameKind;
    /** Its root group, or itself: a root group, or an account in no group. */
    root: string;
}

/**
 * A name completing a request: `text` replaces `request.slice(from, to)`, where `to` is the
 * caret. `text` is the Book's name with its whitespace collapsed and trimmed, which the Worker
 * reads as the name written exactly.
 */
export interface NameCompletion {
    name: BookName;
    text: string;
    from: number;
    to: number;
}

interface Indexed {
    name: BookName;
    kind: NameKind;
    written: string;
    key: string;
    order: number;
}

const WHITESPACE = /\s/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
/** Each character of the Basic Multilingual Plane, once asked: a letter, mark or digit (1) or not (2). */
const WORD_CHARACTERS = new Uint8Array(0x10000);
/** Keys are found by their first UTF-16 units: a text completed has at least as many. */
const BUCKET = MIN_COMPLETION_LENGTH;

/** An index of a Book's names, to complete requests as they are typed. Immutable. */
export class NameIndex {
    /** The names it can offer. */
    readonly size: number;
    private readonly names: Indexed[];
    /** Every name a request can write, by folded name, as the Worker finds them. */
    private readonly byKey = new Map<string, Indexed[]>();
    /**
     * Each folded name, and each of its words to the end of the name, by their first units: the
     * entries `2 × name + (1 if a word inside it)`, and their keys. Best first: a name's start
     * over a word inside it, then the shortest name, then Book order.
     */
    private readonly buckets = new Map<string, { entries: number[]; keys: string[] }>();
    private readonly longest: number;

    /** Indexes `names`, in Book order. */
    constructor(names: readonly BookName[]) {
        const alike = new Map<string, Indexed[]>();
        names.forEach((name, order) => {
            const { written, key } = nameKey(name.name);
            if (!isWritable(key)) return;
            const indexed = { name, kind: name.kind, written, key, order };
            const known = alike.get(written);
            if (known) known.push(indexed);
            else alike.set(written, [indexed]);
            const colliding = this.byKey.get(key);
            if (colliding) colliding.push(indexed);
            else this.byKey.set(key, [indexed]);
        });
        // Of names written alike, the Worker reads one only. Best first: the shortest, then Book
        // order, so each bucket, filled starts first, then words inside names, is in rank order.
        this.names = [...alike]
            .map(([written, candidates]) => pickName(candidates, written))
            .sort((a, b) => a.key.length - b.key.length || a.order - b.order);
        this.size = this.names.length;

        let longest = 0;
        this.names.forEach(({ key }, owner) => {
            longest = Math.max(longest, key.length);
            this.add(key, owner * 2);
        });
        this.names.forEach(({ key }, owner) => {
            for (let i = 1; i < key.length; i++) {
                if (isWordStart(key, i)) this.add(key.slice(i), owner * 2 + 1);
            }
        });
        this.longest = longest;
    }

    /** The names completing `text` at `caret` (a UTF-16 position), best first. */
    complete(text: string, caret: number, limit = MAX_COMPLETIONS): NameCompletion[] {
        if (this.size === 0 || !Number.isInteger(caret) || caret <= 0 || caret > text.length) {
            return [];
        }
        const blank = withoutHashtags(text);
        if (WHITESPACE.test(blank[caret - 1])) return [];
        const boundaries = wordBoundaries(blank);
        const end = boundaries.indexOf(caret);
        if (end === -1) return [];
        const { folded, at } = foldWithOffsets(blank);

        // The texts ending at the caret, longest first.
        const fragments: { from: number; fragment: string }[] = [];
        for (let k = end - 1; k >= 0; k--) {
            const from = boundaries[k];
            if (at[caret] - at[from] > this.longest) break;
            if (WHITESPACE.test(blank[from])) continue;
            const fragment = folded.slice(at[from], at[caret]);
            if ([...fragment].length >= MIN_COMPLETION_LENGTH) {
                fragments.unshift({ from, fragment });
            }
        }

        const completions: NameCompletion[] = [];
        // The names decided: offered, or not, for a longer text.
        const decided = new Uint8Array(this.size);
        for (const { from, fragment } of fragments) {
            const bucket = this.buckets.get(fragment.slice(0, BUCKET));
            if (!bucket) continue;
            const written = collapseWhitespace(text.slice(from, caret));
            // Best first, so a name is met first by its best key, and the first found are offered.
            for (let i = 0; i < bucket.keys.length && completions.length < limit; i++) {
                const owner = bucket.entries[i] >>> 1;
                if (decided[owner] === 1 || !bucket.keys[i].startsWith(fragment)) continue;
                decided[owner] = 1;
                const indexed = this.names[owner];
                const inner = (bucket.entries[i] & 1) === 1;
                // Already written as the Book writes it.
                if (!inner && indexed.key === fragment && indexed.written === written) continue;
                if (this.reads(text, from, caret, indexed)) {
                    completions.push({
                        name: indexed.name,
                        text: indexed.written,
                        from,
                        to: caret,
                    });
                }
            }
            if (completions.length >= limit) break;
        }
        return completions;
    }

    /** Whether the request completed with `indexed` reads it where it is inserted, as the Worker would. */
    private reads(text: string, from: number, to: number, indexed: Indexed): boolean {
        const request = text.slice(0, from) + indexed.written + text.slice(to);
        const end = from + indexed.written.length;
        return matchNames(request, this.byKey, this.longest).some(
            match =>
                match.start === from &&
                match.end === end &&
                pickName(match.candidates, collapseWhitespace(request.slice(from, end))) === indexed
        );
    }

    private add(key: string, entry: number): void {
        const first = key.slice(0, BUCKET);
        const bucket = this.buckets.get(first);
        if (bucket) {
            bucket.entries.push(entry);
            bucket.keys.push(key);
        } else {
            this.buckets.set(first, { entries: [entry], keys: [key] });
        }
    }
}

/** Whether a word starts at `i` of a folded name: a letter, mark or digit after any other character. */
function isWordStart(key: string, i: number): boolean {
    return isWordCharacter(key, i) && !isWordCharacter(key, i - 1);
}

function isWordCharacter(key: string, i: number): boolean {
    const code = key.charCodeAt(i);
    if (code < 0x80) {
        return (
            (code >= 0x30 && code <= 0x39) ||
            (code >= 0x61 && code <= 0x7a) ||
            (code >= 0x41 && code <= 0x5a)
        );
    }
    // Inside a pair of surrogates is no start; a pair is one character.
    if (code >= 0xdc00 && code <= 0xdfff) return i > 0 && isWordCharacter(key, i - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
        return WORD_CHARACTER.test(String.fromCodePoint(key.codePointAt(i) ?? code));
    }
    let known = WORD_CHARACTERS[code];
    if (known === 0) {
        known = WORD_CHARACTER.test(String.fromCharCode(code)) ? 1 : 2;
        WORD_CHARACTERS[code] = known;
    }
    return known === 1;
}
