/**
 * The report of a Bkper query, such as the one a Book shows its transactions with, read by fixed
 * rules, with no AI, the way Bkper's balances read a query (bkper-core `Query`,
 * `BalanceService.findBalances`):
 *
 * - **Groups and accounts.** `group:` and `account:` (`acc:`) names, quoted or not, found among
 *   the Book's groups and accounts at any depth as Bkper finds them: ignoring case and accents,
 *   the characters Bkper drops (`?%*+@#!~\`'":;=\|$^`), and runs of spaces, `-` and `_` alike.
 *   Several are side by side, in the order written, each once, at most {@link MAX_NAMED}; names
 *   the Book does not have are left out. With none, the query has no report
 *   ({@link QueryNotAReportError}).
 * - **One hashtag.** Exactly one `#hashtag` filters the report; Bkper's balances ignore two or
 *   more, and so does the report.
 * - **Dates.** The first `after:`, `before:` and `on:` each, in the Book's date format (`d/M/yyyy`,
 *   `M/yyyy`, `yyyy`, `d/M`, as the format orders them), ISO (`yyyy-mm-dd`, `yyyy-mm`) or a bare
 *   Bkper variable (`$d`, `$m`, `$y`, with `+n` or `-n`); `after:` from its first day, `before:`
 *   up to its first day, `on:` its whole day, month or year. A date Bkper could not read is left
 *   out, as Bkper leaves it out. They become the smallest whole-month period of a report that
 *   contains them ({@link queryPeriod}); with none, Bkper reads a balance now and activity of all
 *   time, and so does the report.
 * - **Everything else** (amounts, text, `is:`, `by:`, `AND`, `OR`, `NOT`, parentheses) is left
 *   out: balances are of whole groups and accounts.
 */
import {
    HASHTAG_PATTERN,
    MAX_HASHTAG_LENGTH,
    MONTHS_OF_YEAR,
    QUARTERS_OF_YEAR,
    type MonthOfYear,
    type PeriodParts,
    type QuarterOfYear,
    type YearPart,
} from 'report-shared/report-intent';
import { isBookDatePattern, type BookDatePattern } from './bkper-dates.js';
import { addDays, type IsoDate, type ReportNature } from './periods.js';
import { MAX_NAMED, mapNames, placeNames, type MapName } from './prompt-names.js';
import { ReportError } from './report.js';
import { ReportIntentSchema, reportIntentOf, type ReportIntent } from './report-intent.js';
import type { Snapshot } from './snapshot.js';

/** The query names no group or account of the Book, so it has no report. */
export class QueryNotAReportError extends Error {
    constructor() {
        super('The query names no group or account of the Book.');
        this.name = 'QueryNotAReportError';
    }
}

/** What a report reads of a query: the rest is left out. */
export interface QueryTerms {
    names: { kind: 'group' | 'account'; name: string }[];
    /** Every hashtag, without `#`. */
    hashtags: string[];
    after?: string;
    before?: string;
    on?: string;
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
    const terms: QueryTerms = { names: [], hashtags: [] };
    let rest = query.trim().replace(/^=/, '');
    while (rest.length > 0) {
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
            if (date && value && terms[date] === undefined) {
                terms[date] = value;
            }
            rest = rest.slice(field[0].length);
            continue;
        }
        const token = (QUOTED.exec(rest) ?? WORD.exec(rest) ?? [rest[0]])[0];
        if (token.startsWith('#') && token.length > 1) {
            terms.hashtags.push(token.slice(1));
        }
        rest = rest.slice(token.length);
    }
    return terms;
}

/**
 * The intent of the report of a query on the Book of the snapshot; {@link QueryNotAReportError}
 * when it names no group or account of the Book, `ReportError` `future_period` when its dates
 * have not started.
 */
export function queryIntent(query: string, snapshot: Snapshot): ReportIntent {
    const terms = parseQuery(query);
    const named = findNames(terms.names, snapshot).slice(0, MAX_NAMED);
    if (named.length === 0) {
        throw new QueryNotAReportError();
    }
    const [first, ...alongside] = placeNames(named);
    const pattern = isBookDatePattern(snapshot.book.datePattern)
        ? snapshot.book.datePattern
        : undefined;
    const period = queryPeriod(
        queryRange(terms, pattern, snapshot.today),
        first.permanent ? 'position' : 'activity',
        snapshot.today
    );
    const [hashtag] = terms.hashtags;
    const filtered =
        terms.hashtags.length === 1 &&
        hashtag.length <= MAX_HASHTAG_LENGTH &&
        HASHTAG_PATTERN.test(hashtag);
    const subject = ({ root, target }: { root: string; target?: string }) => ({
        root,
        ...(target === undefined ? {} : { target }),
    });
    return reportIntentOf(
        ReportIntentSchema.parse({
            ...subject(first),
            ...(alongside.length > 0 ? { alongside: alongside.map(subject) } : {}),
            period,
            monthly: false,
            ...(filtered ? { hashtags: [hashtag] } : {}),
        })
    );
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

/** The months a query's dates read: from `first` to `last`, either open. */
export interface QueryRange {
    first?: MonthIndex;
    last?: MonthIndex;
    /** Every date is a Bkper variable, so the period stays relative to today. */
    relative: boolean;
}

/** The days a date names: from `start` to before `end`. */
interface DateSpan {
    start: IsoDate;
    end: IsoDate;
    relative: boolean;
}

/**
 * The months a query's dates read, as Bkper reads a range: `after:` and `before:` over `on:`;
 * `undefined` with no date Bkper reads, or none in the range.
 */
function queryRange(
    terms: QueryTerms,
    pattern: BookDatePattern | undefined,
    today: IsoDate
): QueryRange | undefined {
    const read = (value: string | undefined) =>
        value === undefined ? undefined : readDate(value, pattern, today);
    const after = read(terms.after);
    const before = read(terms.before);
    const on = read(terms.on);
    const start = after?.start ?? on?.start;
    const end = before?.start ?? on?.end;
    if ((start === undefined && end === undefined) || (start && end && start >= end)) {
        return undefined;
    }
    return {
        ...(start === undefined ? {} : { first: monthOf(start) }),
        ...(end === undefined ? {} : { last: monthOf(addDays(end, -1)) }),
        relative: [after, before, on].every(date => date === undefined || date.relative),
    };
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
                return { start, end: addDays(start, 1), relative: true };
            }
            case 'm':
                return { ...monthSpan(current + offset), relative: true };
            default:
                return { ...yearSpan(Math.floor(current / 12) + offset), relative: true };
        }
    }
    const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    if (iso) {
        return dateSpan(Number(iso[1]), Number(iso[2]), iso[3] && Number(iso[3]));
    }
    if (/^\d{4}$/.test(value)) {
        return { ...yearSpan(Number(value)), relative: false };
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
        return { ...monthSpan(index), relative: false };
    }
    const start = `${monthText(index)}-${String(day).padStart(2, '0')}`;
    // A day past the end of its month, such as 2026-02-30, rolls into the next one.
    if (day < 1 || addDays(addDays(start, 1), -1) !== start) {
        return undefined;
    }
    return { start, end: addDays(start, 1), relative: false };
}

function monthSpan(index: MonthIndex): { start: IsoDate; end: IsoDate } {
    return { start: `${monthText(index)}-01`, end: `${monthText(index + 1)}-01` };
}

function yearSpan(year: number): { start: IsoDate; end: IsoDate } {
    return { start: `${monthText(year * 12)}-01`, end: `${monthText((year + 1) * 12)}-01` };
}

function monthText(index: MonthIndex): string {
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthOf(date: IsoDate): MonthIndex {
    return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

type CalendarKind = 'month' | 'quarter' | 'year';

/** A month, quarter or year, by its first month. */
interface CalendarPeriod {
    kind: CalendarKind;
    first: MonthIndex;
    last: MonthIndex;
}

/**
 * The period of a report of a query's months, the smallest a report has that contains them,
 * from the Book's today; `ReportError` `future_period` when they start after this month.
 *
 * - No dates: activity of all time, a balance now.
 * - Activity: up to this month (a report never reads later months), a month, a quarter, a year,
 *   the last 12 months, else all time; from the start of the Book, all time.
 * - A balance is read at the end of the months: now when they reach this month; else of the
 *   month, quarter or year that ends there and contains them, the smallest, or, when none
 *   does, the largest.
 *
 * Relative dates stay relative where a period can say so (this year, last month, the current
 * quarter); written dates stay written.
 */
export function queryPeriod(
    range: QueryRange | undefined,
    nature: ReportNature,
    today: IsoDate
): PeriodParts {
    const current = monthOf(today);
    if (!range) {
        return nature === 'position' ? { span: 'now' } : { span: 'all_time' };
    }
    if (range.first !== undefined && range.first > current) {
        throw new ReportError('future_period', 'The period has not started');
    }
    const write = (period: CalendarPeriod) => calendarParts(period, range.relative, current);
    if (nature === 'position') {
        const end = range.last ?? current;
        if (end >= current) {
            return { span: 'now' };
        }
        const first = range.first ?? end;
        const ending = calendarPeriods(end, end).filter(period => period.last === end);
        return write(ending.find(period => period.first <= first) ?? ending[ending.length - 1]);
    }
    if (range.first === undefined) {
        return { span: 'all_time' };
    }
    const last = Math.min(range.last ?? current, current);
    const [smallest] = calendarPeriods(range.first, last);
    if (smallest) {
        return write(smallest);
    }
    return range.first >= current - 11 ? { span: 'last_12_months' } : { span: 'all_time' };
}

/** The month, quarter and year of `first` that contain `last` too, smallest first. */
function calendarPeriods(first: MonthIndex, last: MonthIndex): CalendarPeriod[] {
    const periods: CalendarPeriod[] = [
        { kind: 'month', first, last: first },
        { kind: 'quarter', first: first - (first % 3), last: first - (first % 3) + 2 },
        { kind: 'year', first: first - (first % 12), last: first - (first % 12) + 11 },
    ];
    return periods.filter(period => period.last >= last);
}

function calendarParts(
    { kind, first }: CalendarPeriod,
    relative: boolean,
    current: MonthIndex
): PeriodParts {
    const year = Math.floor(first / 12);
    const yearPart: YearPart = relative ? relativeYear(year, Math.floor(current / 12)) : year;
    switch (kind) {
        case 'month':
            if (relative && (first === current || first === current - 1)) {
                return { span: 'month', month: first === current ? 'current' : 'previous' };
            }
            return { span: 'month', year: yearPart, month: monthOfYear(first) };
        case 'quarter': {
            const start = current - (current % 3);
            if (relative && (first === start || first === start - 3)) {
                return { span: 'quarter', quarter: first === start ? 'current' : 'previous' };
            }
            return { span: 'quarter', year: yearPart, quarter: quarterOfYear(first) };
        }
        default:
            return { span: 'year', year: yearPart };
    }
}

function relativeYear(year: number, currentYear: number): YearPart {
    switch (year - currentYear) {
        case 0:
            return 'current';
        case -1:
            return 'previous';
        case -2:
            return 'before_previous';
        default:
            return year;
    }
}

function monthOfYear(index: MonthIndex): MonthOfYear {
    return MONTHS_OF_YEAR[index % 12];
}

function quarterOfYear(index: MonthIndex): QuarterOfYear {
    return QUARTERS_OF_YEAR[Math.floor((index % 12) / 3)];
}
