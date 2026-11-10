/**
 * The report of a Bkper query, such as the one a Book shows its transactions with, read exactly
 * as sent, with no AI: the query itself is Bkper's balances query of the report, so every amount
 * it shows is the one Bkper's own sidebar shows for that query, future-dated transactions and
 * all. Nothing in it is rewritten, cut off or moved.
 *
 * - **What it is of.** Its `group:` and `account:` (`acc:`) names, quoted or not, found among the
 *   Book's groups and accounts at any depth as Bkper finds them: ignoring case and accents, the
 *   characters Bkper drops (`?%*+@#!~\`'":;=\|$^`), and runs of spaces, `-` and `_` alike.
 *   Several are side by side, in the order written, each once, at most {@link MAX_NAMED}; names
 *   the Book does not have are left out. With none, the query has no report
 *   ({@link QueryNotAReportError}); nor when Bkper's answer holds none of them.
 * - **Months**, for charts by month, come from a separate query, the same with `by:m`, and only
 *   when Bkper answers it with the same totals (see `buildQueryReport`).
 * - **The comparison** comes from a separate query, the same with its dates moved to the period
 *   before ({@link previousDays}), written in place of its own: only for a query whose dates
 *   end, each written once.
 * - **Its period** is named by the days Bkper says it read; its own `after:`, `before:` and
 *   `on:` dates are read here too, in the Book's date format (`d/M/yyyy`, `M/yyyy`, `yyyy`,
 *   `d/M`, as the format orders them), ISO (`yyyy-mm-dd`, `yyyy-mm`) or as a bare Bkper variable
 *   (`$d`, `$m`, `$y`, with `+n` or `-n`), to write the comparison's.
 */
import {
    isBookDatePattern,
    writeBookDate,
    type BookDatePattern,
    type QueryDays,
} from './bkper-dates.js';
import { addDays, type IsoDate } from './periods.js';
import { MAX_NAMED, mapNames, placeNames, type MapName } from './prompt-names.js';
import { QueryNotAReportError, subjectNodes, type QueryReportPlan } from './report.js';
import type { Snapshot } from './snapshot.js';

export { QueryNotAReportError };

/** A date term of a query, and where it is written. */
export interface DateTerm {
    field: 'after' | 'before' | 'on';
    value: string;
    /** Where the term starts and ends in the query. */
    start: number;
    end: number;
}

/** What a report reads of a query to name and compare it: Bkper reads the rest. */
export interface QueryTerms {
    names: { kind: 'group' | 'account'; name: string }[];
    /** Every date term, in the order written. */
    dates: DateTerm[];
    /** Whether it asks for balances by month (`by:m`). */
    byMonth: boolean;
}

const NAME_FIELDS = new Map<string, 'group' | 'account'>([
    ['group', 'group'],
    ['account', 'account'],
    ['acc', 'account'],
]);

const DATE_FIELDS = ['after', 'before', 'on'] as const;

/** A `field:value`, its value quoted with either quote or bare up to a space or parenthesis. */
const FIELD = /^([A-Za-z]+):(?:"([^"]*)"|'([^']*)'|([^\s()]*))/;
const QUOTED = /^(?:"[^"]*"|'[^']*')/;
const WORD = /^[^\s()]+/;
/** Between terms: spaces, parentheses and the signs of required or excluded terms. */
const SEPARATORS = /^[\s()+\-!]+/;

/** The terms of a query a report reads, in the order written. */
export function parseQuery(query: string): QueryTerms {
    const terms: QueryTerms = { names: [], dates: [], byMonth: false };
    // Always a suffix of the query, so each term's place in it is known.
    let rest = query.trimStart().replace(/^=/, '');
    while (rest.length > 0) {
        const start = query.length - rest.length;
        const separators = SEPARATORS.exec(rest);
        if (separators) {
            rest = rest.slice(separators[0].length);
            continue;
        }
        const field = FIELD.exec(rest);
        if (field) {
            const key = field[1].toLowerCase();
            const value = field[2] ?? field[3] ?? field[4];
            const kind = NAME_FIELDS.get(key);
            if (kind && value.trim()) {
                terms.names.push({ kind, name: value });
            }
            const date = DATE_FIELDS.find(name => name === key);
            if (date && value) {
                terms.dates.push({ field: date, value, start, end: start + field[0].length });
            }
            if (key === 'by' && value.toLowerCase() === 'm') {
                terms.byMonth = true;
            }
            rest = rest.slice(field[0].length);
            continue;
        }
        const token = (QUOTED.exec(rest) ?? WORD.exec(rest) ?? [rest[0]])[0];
        rest = rest.slice(token.length);
    }
    return terms;
}

/**
 * Whether a text is a Bkper query rather than a person's words: it names a group or an account
 * with Bkper's own syntax (`group:'…'`, `account:'…'`, `acc:'…'`). A report's own text of a
 * query is that query, so sent back as a prompt it asks for the same report.
 */
export function isBkperQuery(text: string): boolean {
    return parseQuery(text).names.length > 0;
}

/**
 * The report of a query on the Book of the snapshot, read as sent;
 * {@link QueryNotAReportError} when it names no group or account of the Book, and the
 * `ReportError`s of an intent's subjects (positions with activity side by side, a group that
 * mixes them).
 */
export function planQueryReport(query: string, snapshot: Snapshot): QueryReportPlan {
    const terms = parseQuery(query);
    const named = findNames(terms.names, snapshot).slice(0, MAX_NAMED);
    if (named.length === 0) {
        throw new QueryNotAReportError();
    }
    const nodes = subjectNodes(
        placeNames(named).map(({ root, target }) => ({
            root,
            ...(target === undefined ? {} : { target }),
        })),
        snapshot
    );
    const pattern = isBookDatePattern(snapshot.book.datePattern)
        ? snapshot.book.datePattern
        : undefined;
    const days = queryDays(terms.dates, pattern, snapshot.today);
    const comparison = days && pattern && comparisonOf(query, terms.dates, days, pattern);
    return {
        query,
        nodes,
        nature: nodes[0].permanent ? 'position' : 'activity',
        ...(days ? { days } : {}),
        monthsQuery: terms.byMonth ? query : `${query} by:m`,
        ...(comparison ? { comparison } : {}),
    };
}

/** The groups and accounts the names find, in the order written, each once. */
function findNames(names: QueryTerms['names'], snapshot: Snapshot): MapName[] {
    const byKey = new Map<string, MapName>();
    for (const name of mapNames(snapshot)) {
        const key = `${name.kind}:${bkperName(name.name)}`;
        if (!byKey.has(key)) {
            byKey.set(key, name);
        }
    }
    const found: MapName[] = [];
    for (const { kind, name } of names) {
        const node = byKey.get(`${kind}:${bkperName(name)}`);
        if (node && !found.includes(node)) {
            found.push(node);
        }
    }
    return found;
}

/**
 * A name as Bkper compares names (bkper-core `StringUtil.normalize`): without the characters it
 * drops, runs of spaces, `-` and `_` as one `_`, lowercase and without accents.
 */
export function bkperName(name: string): string {
    return name
        .replace(/[?%*+@#!~`'":;=\\|$^ˆ\p{Cc}]/gu, '')
        .replace(/^[\s\-_]+|[\s\-_]+$/g, '')
        .replace(/[\s\-_]+/g, '_')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/** Months are counted as `year * 12 + (month - 1)`, so month arithmetic is integer arithmetic. */
type MonthIndex = number;

/** The days a date names: from `start` to before `end`. */
interface DateSpan {
    start: IsoDate;
    end: IsoDate;
}

/**
 * The days a query's dates name, as Bkper reads a range: the first `after:`, `before:` and
 * `on:` each, `after:` from its first day, `before:` up to its first day, `on:` its whole day,
 * month or year, `after:` and `before:` over `on:`; none for a query with no dates.
 * `undefined` when a date cannot be read here, or the range ends before it starts.
 */
export function queryDays(
    dates: DateTerm[],
    pattern: BookDatePattern | undefined,
    today: IsoDate
): QueryDays | undefined {
    const spans = new Map<DateTerm['field'], DateSpan | undefined>();
    for (const term of dates) {
        if (!spans.has(term.field)) {
            spans.set(term.field, readDate(term.value, pattern, today));
        }
    }
    if ([...spans.values()].some(span => span === undefined)) {
        return undefined;
    }
    const start = spans.get('after')?.start ?? spans.get('on')?.start;
    const end = spans.get('before')?.start ?? spans.get('on')?.end;
    if (start !== undefined && end !== undefined && start >= end) {
        return undefined;
    }
    return {
        ...(start === undefined ? {} : { after: start }),
        ...(end === undefined ? {} : { before: end }),
    };
}

/**
 * The period a query's report compares with, by its days:
 *
 * - from a day to another: as many whole months before when both are first days of a month
 *   (a year, a quarter, a month), else as many days before;
 * - up to a day, from the start of the Book: up to the end of the month before, as a balance
 *   now compares with the end of last month;
 * - with no end: none.
 */
export function previousDays({ after, before }: QueryDays): QueryDays | undefined {
    if (before === undefined) {
        return undefined;
    }
    if (after === undefined) {
        return {
            before: isMonthStart(before)
                ? monthStart(monthOf(before) - 1)
                : monthStart(monthOf(before)),
        };
    }
    if (isMonthStart(after) && isMonthStart(before)) {
        const months = monthOf(before) - monthOf(after);
        return { after: monthStart(monthOf(after) - months), before: after };
    }
    const days = Math.round((Date.parse(before) - Date.parse(after)) / 86_400_000);
    return { after: addDays(after, -days), before: after };
}

/**
 * The query of the period before, written in place of the query's own dates, in the Book's date
 * format, so everything else stays as sent; none when a date field is written more than once,
 * or `on:` with `after:` or `before:`, whose reading would be in doubt.
 */
function comparisonOf(
    query: string,
    dates: DateTerm[],
    days: QueryDays,
    pattern: BookDatePattern
): { query: string; days: QueryDays } | undefined {
    const fields = dates.map(term => term.field);
    if (new Set(fields).size !== fields.length || (fields.includes('on') && fields.length > 1)) {
        return undefined;
    }
    const previous = previousDays(days);
    if (!previous) {
        return undefined;
    }
    const write = (field: 'after' | 'before', date: IsoDate | undefined) =>
        date === undefined ? '' : `${field}:${writeBookDate(date, pattern)}`;
    let written = query;
    for (const term of [...dates].sort((a, b) => b.start - a.start)) {
        const replacement =
            term.field === 'on'
                ? `${write('after', previous.after)} ${write('before', previous.before)}`
                : write(term.field, previous[term.field]);
        written = written.slice(0, term.start) + replacement + written.slice(term.end);
    }
    return { query: written, days: previous };
}

/** The days of a date as Bkper reads it in the Book's date format, or `undefined`. */
function readDate(
    value: string,
    pattern: BookDatePattern | undefined,
    today: IsoDate
): DateSpan | undefined {
    const variable = /^\$([dmy])(?:([+-]\d+))?$/.exec(value);
    if (variable) {
        const offset = Number(variable[2] ?? 0);
        const current = monthOf(today);
        switch (variable[1]) {
            case 'd': {
                const start = addDays(today, offset);
                return { start, end: addDays(start, 1) };
            }
            case 'm':
                return monthSpan(current + offset);
            default:
                return yearSpan(Math.floor(current / 12) + offset);
        }
    }
    const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    if (iso) {
        return dateSpan(Number(iso[1]), Number(iso[2]), iso[3] && Number(iso[3]));
    }
    if (/^\d{4}$/.test(value)) {
        return yearSpan(Number(value));
    }
    const parts = value.split('/');
    if (!pattern || parts.length < 2 || parts.length > 3 || !parts.every(isNumber)) {
        return undefined;
    }
    const yearFirst = pattern === 'yyyy/MM/dd';
    if (parts.length === 3) {
        const [year, month, day] = yearFirst
            ? parts
            : pattern === 'dd/MM/yyyy'
              ? [parts[2], parts[1], parts[0]]
              : [parts[2], parts[0], parts[1]];
        return year.length === 4 && month.length <= 2 && day.length <= 2
            ? dateSpan(Number(year), Number(month), Number(day))
            : undefined;
    }
    // A month of a year, else a day of this year.
    const [year, month] = yearFirst ? parts : [parts[1], parts[0]];
    if (year.length === 4 && month.length <= 2) {
        return dateSpan(Number(year), Number(month));
    }
    const [day, dayMonth] = pattern === 'dd/MM/yyyy' ? parts : [parts[1], parts[0]];
    return day.length <= 2 && dayMonth.length <= 2
        ? dateSpan(Number(today.slice(0, 4)), Number(dayMonth), Number(day))
        : undefined;
}

function isNumber(text: string): boolean {
    return /^\d+$/.test(text);
}

/** A written day or month, or `undefined` when it does not exist. */
function dateSpan(year: number, month: number, day?: number | ''): DateSpan | undefined {
    if (month < 1 || month > 12) {
        return undefined;
    }
    const index = year * 12 + month - 1;
    if (day === undefined || day === '') {
        return monthSpan(index);
    }
    const start = `${monthText(index)}-${String(day).padStart(2, '0')}`;
    // A day past the end of its month, such as 2026-02-30, rolls into the next one.
    if (day < 1 || addDays(addDays(start, 1), -1) !== start) {
        return undefined;
    }
    return { start, end: addDays(start, 1) };
}

function monthSpan(index: MonthIndex): DateSpan {
    return { start: monthStart(index), end: monthStart(index + 1) };
}

function yearSpan(year: number): DateSpan {
    return { start: monthStart(year * 12), end: monthStart((year + 1) * 12) };
}

function monthStart(index: MonthIndex): IsoDate {
    return `${monthText(index)}-01`;
}

function monthText(index: MonthIndex): string {
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthOf(date: IsoDate): MonthIndex {
    return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function isMonthStart(date: IsoDate): boolean {
    return date.endsWith('-01');
}
