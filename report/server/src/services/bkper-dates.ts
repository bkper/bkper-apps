/**
 * The dates Bkper read for a query, as it writes them in the Book's date format: a year
 * (`2026`), a month (`11/2026`, or `2026/11` in year-first Books) or a day (`10/11/2026`,
 * `11/10/2026`, `2026/11/10`). Reports are labelled from these, so a label says what Bkper
 * read, never what the app expected it to read.
 */
import { addDays, type IsoDate } from './periods.js';

/** The date formats of Bkper Books. */
export const BOOK_DATE_PATTERNS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd'] as const;

export type BookDatePattern = (typeof BOOK_DATE_PATTERNS)[number];

export function isBookDatePattern(pattern: string | undefined): pattern is BookDatePattern {
    return (BOOK_DATE_PATTERNS as readonly (string | undefined)[]).includes(pattern);
}

/**
 * The first day of a year, month or day written in a Book's date format, as an ISO date; throws
 * for anything else.
 */
export function parseBookDate(text: string, pattern: BookDatePattern): IsoDate {
    const parts = text.split('/');
    let year: string | undefined;
    let month = '01';
    let day = '01';
    if (parts.length === 1) {
        [year] = parts;
    } else if (parts.length === 2) {
        [year, month] = pattern === 'yyyy/MM/dd' ? parts : [parts[1], parts[0]];
    } else if (parts.length === 3) {
        if (pattern === 'yyyy/MM/dd') {
            [year, month, day] = parts;
        } else if (pattern === 'dd/MM/yyyy') {
            [day, month, year] = parts;
        } else {
            [month, day, year] = parts;
        }
    }
    const iso = `${year}-${month}-${day}`;
    // A day past the end of its month, such as 2026-02-30, rolls into the next one.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || addDays(addDays(iso, 1), -1) !== iso) {
        throw new Error(`Not a date in ${pattern}: ${text}`);
    }
    return iso;
}

/** The bounds of a range as Bkper writes it, such as ` after:2026 before:2026/12 by:m`. */
export interface BkperRange {
    after?: IsoDate;
    before?: IsoDate;
    by?: string;
}

/** The bounds of a range, each the first day it names; throws for anything else. */
export function readRange(range: string, pattern: BookDatePattern): BkperRange {
    const read: BkperRange = {};
    for (const token of range.trim().split(/\s+/)) {
        const match = /^(after|before|by):(\S+)$/.exec(token);
        const key = match?.[1];
        if (!match || (key !== 'after' && key !== 'before' && key !== 'by') || key in read) {
            throw new Error(`Unexpected range: ${range}`);
        }
        read[key] = key === 'by' ? match[2] : parseBookDate(match[2], pattern);
    }
    return read;
}

/** The days a query read: from `after` (none when from the start of the Book) to before `before`. */
export interface ReadDays {
    after?: IsoDate;
    before: IsoDate;
}

/**
 * The days Bkper says it read, from the first and last days it labels a query's answer with:
 * an empty or missing first label reads from the start of the Book. `undefined` when the Book's
 * date format is unknown or a label is not a day in it, as in answers cached before Bkper's
 * labels were kept.
 */
export function readDays(
    labels: { rangeBeginLabel?: string; rangeEndLabel?: string },
    pattern: string | undefined
): ReadDays | undefined {
    const { rangeBeginLabel: begin, rangeEndLabel: end } = labels;
    if (!isBookDatePattern(pattern) || !isDay(end, pattern) || (begin && !isDay(begin, pattern))) {
        return undefined;
    }
    return {
        ...(begin ? { after: parseBookDate(begin, pattern) } : {}),
        before: addDays(parseBookDate(end, pattern), 1),
    };
}

/** A whole day written in the Book's date format: three parts, never a month or a year. */
function isDay(text: string | undefined, pattern: BookDatePattern): text is string {
    if (text?.split('/').length !== 3) {
        return false;
    }
    try {
        parseBookDate(text, pattern);
        return true;
    } catch {
        return false;
    }
}
