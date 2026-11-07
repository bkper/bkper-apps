/**
 * The groups and accounts a request names: code, not the decision model, finds the exact names
 * of the Book's groups and accounts in the request's text, so whatever wrote the text (a person
 * typing, autocomplete, a saved request, a link, an agent) gets the report of what it names.
 *
 * The rules, in order, all deterministic:
 *
 * 1. **Whole names, ignoring case and accents.** Names and the request are compared folded:
 *    compatibility-decomposed, lowercased, without combining marks, each run of whitespace one
 *    space. A name matches only as a whole: it starts and ends at a word boundary
 *    (`Intl.Segmenter`, which also splits words in languages written without spaces) or next
 *    to a character that is not a letter, mark or digit. Names of one character are never
 *    matched: they read as articles and conjunctions in many languages. `#hashtags` are filters,
 *    so names in them do not count.
 * 2. **The longest match wins.** Matches are taken longest first, and on equal length the one
 *    that starts first; a match that overlaps one already taken is dropped. So "HSBC tarifas"
 *    names that account, not "HSBC".
 * 3. **Colliding names.** When several groups or accounts fold to the same text, the one written
 *    exactly as in the request (case and accents) wins, then a group over an account, then the
 *    first in Book order (root groups in order, each with its subgroups, then its accounts, then
 *    the accounts in no group).
 * 4. **Each once, in the order written,** at most {@link MAX_NAMED}.
 * 5. **Roots.** A group's root is its top-level group; an account in no group is a root of its
 *    own. An account under several roots is read from a root that another name of the request
 *    can only be read from, so the report queries fewer roots, else from the first root in Book
 *    order that holds it: either way it is the account's own Bkper balance.
 */
import { MAX_ALONGSIDE } from 'report-shared/report-intent';
import type { IsoMonth } from './periods.js';
import type { Snapshot } from './snapshot.js';

/** The most groups and accounts a request names: the first and those side by side with it. */
export const MAX_NAMED = 1 + MAX_ALONGSIDE;

/** Letters, marks, digits, `_` and `-` after `#`; punctuation ends a hashtag. */
export const HASHTAG = /#([\p{L}\p{M}\p{N}_-]+)/gu;

/** A group or account the request names, and where a report reads it. */
export interface PromptName {
    /** The name as the Book writes it. */
    name: string;
    kind: 'group' | 'account';
    /** The root group, or the account in no group. */
    root: string;
    /** The group or account under {@link root}; absent when it is the root. */
    target?: string;
    /** Position to a date (Asset, Liability) rather than activity in a period. */
    permanent: boolean;
    /** The months it had movements in, as the map knows them (none for an account in no group). */
    activeMonths: IsoMonth[];
}

interface Candidate {
    id: string;
    kind: 'group' | 'account';
    name: string;
    /** The name with its whitespace collapsed, to tell an exact match. */
    written: string;
    /** Its place in Book order. */
    order: number;
    /** A group's root, or the roots that hold an account, in Book order (itself when in no group). */
    roots: string[];
    permanent: boolean;
    activeMonths: IsoMonth[];
}

interface Match {
    start: number;
    end: number;
    /** The folded length: longer matches win. */
    length: number;
    candidates: Candidate[];
}

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'word' });
const WHITESPACE = /^\s$/u;
const MARKS = /\p{M}+/gu;
const FINAL_SIGMA = /ς/g;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** Whitespace other than single spaces. */
const OTHER_WHITESPACE = /[^\S ]|  /u;
const ONE_CHARACTER = /^.?$/u;
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{M}\p{N}]/gu;

/** The groups and accounts `prompt` names, by the rules of this module, in the order written. */
export function findPromptNames(prompt: string, snapshot: Snapshot): PromptName[] {
    const { names, longest } = indexNames(snapshot);
    if (names.size === 0) {
        return [];
    }
    const text = prompt.replace(HASHTAG, hashtag => ' '.repeat(hashtag.length));
    const { folded, at } = foldWithOffsets(text);
    const boundaries = wordBoundaries(text);

    const matches: Match[] = [];
    for (let i = 0; i < boundaries.length; i++) {
        const start = boundaries[i];
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

    const taken: Match[] = [];
    for (const match of matches.sort((a, b) => b.length - a.length || a.start - b.start)) {
        if (taken.every(other => match.end <= other.start || match.start >= other.end)) {
            taken.push(match);
        }
    }

    const chosen: Candidate[] = [];
    for (const match of taken.sort((a, b) => a.start - b.start)) {
        const candidate = pick(match.candidates, collapse(text.slice(match.start, match.end)));
        if (!chosen.some(known => known.kind === candidate.kind && known.id === candidate.id)) {
            chosen.push(candidate);
        }
    }
    const named = chosen.slice(0, MAX_NAMED);

    // Roots that names of the request can only be read from.
    const namedRoots = new Set(
        named.filter(candidate => candidate.roots.length === 1).map(({ roots }) => roots[0])
    );
    return named.map(candidate => {
        const root = candidate.roots.find(id => namedRoots.has(id)) ?? candidate.roots[0];
        return {
            name: candidate.name,
            kind: candidate.kind,
            root,
            ...(candidate.id === root ? {} : { target: candidate.id }),
            permanent: candidate.permanent,
            activeMonths: candidate.activeMonths,
        };
    });
}

/** The one of colliding candidates the request means: written exactly, a group, first in Book order. */
function pick(candidates: Candidate[], written: string): Candidate {
    const exact = candidates.filter(candidate => candidate.written === written);
    const pool = exact.length > 0 ? exact : candidates;
    return [...pool].sort(
        (a, b) => Number(a.kind === 'account') - Number(b.kind === 'account') || a.order - b.order
    )[0];
}

/** Every group and account of the map by folded name, in Book order, and the longest folded name. */
function indexNames(snapshot: Snapshot): { names: Map<string, Candidate[]>; longest: number } {
    const names = new Map<string, Candidate[]>();
    const groups = new Set<string>();
    const accounts = new Map<string, Candidate>();
    let order = 0;
    let longest = 0;
    const add = (
        kind: Candidate['kind'],
        { id, name, permanent }: { id: string; name: string; permanent: boolean },
        roots: string[],
        activeMonths: IsoMonth[]
    ): Candidate => {
        const written = collapse(name).trim();
        const candidate = {
            id,
            kind,
            name,
            written,
            order: order++,
            roots,
            permanent,
            activeMonths,
        };
        const key = fold(written);
        // One character reads as an article or a conjunction in many languages.
        if (!ONE_CHARACTER.test(key)) {
            const known = names.get(key);
            if (known) {
                known.push(candidate);
            } else {
                names.set(key, [candidate]);
            }
            longest = Math.max(longest, key.length);
        }
        return candidate;
    };

    for (const root of snapshot.roots) {
        const visit = (id: string): void => {
            const group = snapshot.groups[id];
            if (!group || groups.has(id)) {
                return;
            }
            groups.add(id);
            add('group', group, [root], group.activeMonths);
            group.groups.forEach(visit);
            for (const accountId of group.accounts) {
                const account = snapshot.accounts[accountId];
                const known = accounts.get(accountId);
                if (known) {
                    if (!known.roots.includes(root)) {
                        known.roots.push(root);
                    }
                } else if (account) {
                    accounts.set(accountId, add('account', account, [root], account.activeMonths));
                }
            }
        };
        visit(root);
    }
    for (const account of Object.values(snapshot.ungrouped)) {
        add('account', account, [account.id], []);
    }
    return { names, longest };
}

/**
 * The folded text, and where each UTF-16 position of `text` falls in it: compatibility
 * decomposition, lowercase, no combining marks, each run of whitespace one space.
 */
function foldWithOffsets(text: string): { folded: string; at: number[] } {
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

/** Each run of whitespace as one space. */
function collapse(text: string): string {
    return OTHER_WHITESPACE.test(text) ? text.replace(/\s+/gu, ' ') : text;
}

/** Where a whole name may start or end, ascending: word boundaries, and around non-word characters. */
function wordBoundaries(text: string): number[] {
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
