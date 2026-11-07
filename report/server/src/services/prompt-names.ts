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
 *    so names in them do not count. These rules live in `report-shared/names`, which the web
 *    client completes names by too.
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
import {
    collapseWhitespace,
    isWritable,
    matchNames,
    nameKey,
    pickName,
    withoutHashtags,
    type NameKind,
} from 'report-shared/names';
import type { BookName } from 'report-shared/name-index';
import type { IsoMonth } from './periods.js';
import type { Snapshot } from './snapshot.js';

export { HASHTAG } from 'report-shared/names';

/** The most groups and accounts a request names: the first and those side by side with it. */
export const MAX_NAMED = 1 + MAX_ALONGSIDE;

/** A group or account the request names, and where a report reads it. */
export interface PromptName {
    /** The name as the Book writes it. */
    name: string;
    kind: NameKind;
    /** The root group, or the account in no group. */
    root: string;
    /** The group or account under {@link root}; absent when it is the root. */
    target?: string;
    /** Position to a date (Asset, Liability) rather than activity in a period. */
    permanent: boolean;
    /** The months it had movements in, as the map knows them (none for an account in no group). */
    activeMonths: IsoMonth[];
}

/** A group or account of the map, in Book order. */
export interface MapName {
    id: string;
    kind: NameKind;
    name: string;
    /** A group's root, or the roots that hold an account, in Book order (itself when in no group). */
    roots: string[];
    permanent: boolean;
    activeMonths: IsoMonth[];
}

interface Candidate extends MapName {
    /** The name with its whitespace collapsed, to tell an exact match. */
    written: string;
    /** Its place in Book order. */
    order: number;
}

/** The groups and accounts `prompt` names, by the rules of this module, in the order written. */
export function findPromptNames(prompt: string, snapshot: Snapshot): PromptName[] {
    const { names, longest } = indexNames(snapshot);
    const text = withoutHashtags(prompt);
    const chosen: Candidate[] = [];
    for (const match of matchNames(text, names, longest)) {
        const candidate = pickName(
            match.candidates,
            collapseWhitespace(text.slice(match.start, match.end))
        );
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

/**
 * The map's groups and accounts as the app's API lists them, to complete requests as they are
 * typed: in Book order, each with the first root that holds it.
 */
export function bookNames(snapshot: Snapshot): BookName[] {
    return mapNames(snapshot).map(({ id, name, kind, roots }) => ({
        id,
        name,
        kind,
        root: roots[0],
    }));
}

/**
 * Every group and account of the map, each once, in Book order: root groups in order, each with
 * its subgroups, then its accounts, then the accounts in no group.
 */
export function mapNames(snapshot: Snapshot): MapName[] {
    const names: MapName[] = [];
    const groups = new Set<string>();
    const accounts = new Map<string, MapName>();
    for (const root of snapshot.roots) {
        const visit = (id: string): void => {
            const group = snapshot.groups[id];
            if (!group || groups.has(id)) {
                return;
            }
            groups.add(id);
            names.push(mapName('group', group, [root], group.activeMonths));
            group.groups.forEach(visit);
            for (const accountId of group.accounts) {
                const account = snapshot.accounts[accountId];
                const known = accounts.get(accountId);
                if (known) {
                    if (!known.roots.includes(root)) {
                        known.roots.push(root);
                    }
                } else if (account) {
                    const name = mapName('account', account, [root], account.activeMonths);
                    accounts.set(accountId, name);
                    names.push(name);
                }
            }
        };
        visit(root);
    }
    for (const account of Object.values(snapshot.ungrouped)) {
        names.push(mapName('account', account, [account.id], []));
    }
    return names;
}

function mapName(
    kind: NameKind,
    { id, name, permanent }: { id: string; name: string; permanent: boolean },
    roots: string[],
    activeMonths: IsoMonth[]
): MapName {
    return { id, kind, name, roots, permanent, activeMonths };
}

/** Every writable name of the map by folded name, in Book order, and the longest folded name. */
function indexNames(snapshot: Snapshot): { names: Map<string, Candidate[]>; longest: number } {
    const names = new Map<string, Candidate[]>();
    let longest = 0;
    mapNames(snapshot).forEach((name, order) => {
        const { written, key } = nameKey(name.name);
        if (!isWritable(key)) {
            return;
        }
        const candidate = { ...name, written, order };
        const known = names.get(key);
        if (known) {
            known.push(candidate);
        } else {
            names.set(key, [candidate]);
        }
        longest = Math.max(longest, key.length);
    });
    return { names, longest };
}
