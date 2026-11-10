/**
 * A report's compact state: its intent and language in at most {@link MAX_STATE_LENGTH}
 * letters, digits, `_` and `-`, the opaque app state Bkper keeps in a Book's URL
 * (`appState`), so a link, Back or a reload opens the same report again, by intent.
 *
 * The state names the root and the target by their ids, which stay valid when they are
 * renamed. It is a version, then the base64url of
 * `<monthly><view><chart>[y].<period>.<language>.<hashtags>.<root>`: one letter each for the
 * month flag, the view and the chart, then `y` only for a comparison with the same period a
 * year earlier (so a comparison with the period before writes what it wrote before), hashtags
 * joined by `,` (neither `.` nor `,` can be in a
 * hashtag), and the root last, so it may hold anything. A report of a target under its root
 * is version `2`, with the target before the root: `….<hashtags>.<target>.<root>`, so a target
 * cannot hold a `.`. A report of targets side by side is version `3`,
 * `….<hashtags>.<alongside>.<target>.<root>`: the first target (empty for a root) and its root
 * as in version `2`, after the others joined by `,`, each `<root>` or `<target>:<root>`, so
 * their ids cannot hold a `.`, `,` or `:`. Every other report keeps version `1`.
 *
 * Those three versions write the period as a period id (`last_year`, `2023`, `2023-Q3`, …),
 * and are still written for every period an id says, so states written before stay the same
 * and open the same report. Any other period is version `4`,
 * `….<hashtags>.<alongside>.<target>.<root>` as in version `3` (both may be empty), its
 * period written as its parts: a letter for the span, the year (a letter, or four digits),
 * the month (a letter: `A` January to `L` December) and the quarter (a digit), `_` for each
 * part left out, `c` and `p` for the current and previous ones, `b` for the year before last,
 * then `~` and the compared year, month and quarter when there are some: `yp__~2023__` is
 * last year compared with 2023.
 */
import type { ReportSpec } from './catalog';
import { withoutIsolates } from './bidi';
import { supportedLanguage } from './languages';
import {
    HASHTAG_PATTERN,
    MAX_ALONGSIDE,
    MAX_HASHTAGS,
    MAX_HASHTAG_LENGTH,
    MAX_ROOT_LENGTH,
    MONTHS_OF_YEAR,
    PERIOD_ID_PATTERN,
    QUARTERS_OF_YEAR,
    intentWithParts,
    periodIdOf,
    validComparedParts,
    validPeriodParts,
    type ChartPreference,
    type ComparedParts,
    type PeriodSpan,
    type RelativeUnit,
    type RelativeYear,
    type ReportIntentData,
    type ReportSubjectData,
    type ReportView,
} from './report-intent';

/** The longest app state Bkper keeps. */
export const MAX_STATE_LENGTH = 128;

/** What Bkper accepts as app state. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The menu URL's expression, which older Bkper versions leave in the URL unreplaced. */
const STATE_EXPRESSION = '${app.state}';

/**
 * The version of a state without a target, of one with a target, and of targets side by side,
 * each with a period id; and of a state with a period as parts.
 */
const VERSION = '1';
const TARGET_VERSION = '2';
const ALONGSIDE_VERSION = '3';
const PARTS_VERSION = '4';

/** The fields before the root, in each version. */
const FIELDS: Record<string, number> = {
    [VERSION]: 4,
    [TARGET_VERSION]: 5,
    [ALONGSIDE_VERSION]: 6,
    [PARTS_VERSION]: 6,
};

/** Each letter names one value forever: states written before must open the same report. */
const VIEW_CODES: Record<ReportView | 'none', string> = {
    none: '_',
    trend: 't',
    breakdown: 'b',
    total: 'o',
};

/** No chart and `auto` are written alike: both leave the chart to the rules. */
const CHART_CODES: Record<ChartPreference, string> = {
    auto: 'a',
    pie: 'p',
    stacked: 's',
    area: 'r',
    compare: 'c',
    waterfall: 'w',
    table: 't',
    bar: 'b',
    line: 'l',
    'ranked-bar': 'k',
    donut: 'd',
};

/** The flag of a comparison with the same period a year earlier, after the chart's letter. */
const YEAR_EARLIER_CODE = 'y';

/** Each letter names one part forever, as the letters of views and charts. */
const SPAN_CODES: Record<PeriodSpan | 'none', string> = {
    none: '_',
    month: 'm',
    quarter: 'q',
    year: 'y',
    year_to_date: 't',
    last_12_months: 'l',
    all_time: 'a',
    now: 'n',
};

const YEAR_CODES: Record<RelativeYear | 'none', string> = {
    none: '_',
    current: 'c',
    previous: 'p',
    before_previous: 'b',
};

/** A month or quarter: none, the current or previous one, or a named one. */
const UNIT_CODES: Record<RelativeUnit | 'none', string> = {
    none: '_',
    current: 'c',
    previous: 'p',
};

/** January to December. */
const MONTH_LETTERS = 'ABCDEFGHIJKL';

/** The separator of the compared parts, after the period's. */
const COMPARED_CODE = '~';

/** The period's span, year, month and quarter, then optionally the compared year, month and quarter. */
const PARTS_PATTERN =
    /^([_mqytlan])([_cpb]|\d{4})([_cpA-L])([_cp1-4])(?:~([_cpb]|\d{4})([_cpA-L])([_cp1-4]))?$/;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A report to open again: its intent, and the language of its texts when known. */
export interface ReportState {
    intent: ReportIntentData;
    language?: string;
}

/**
 * The compact state of a report, or `undefined` when it is longer than Bkper keeps or its
 * intent is not one {@link decodeReportState} would open.
 */
export function encodeReportState({ intent, language }: ReportState): string | undefined {
    if (
        !validPeriodParts(intent.period) ||
        (intent.compared !== undefined && !validComparedParts(intent.compared))
    ) {
        return undefined;
    }
    const id = periodIdOf(intent);
    return writeState(intent, id ?? partsCode(intent), id === undefined, language);
}

/**
 * The state of an intent with its period written as `period`: a period id in the versions
 * before parts, or the code of its parts.
 */
function writeState(
    intent: Omit<ReportIntentData, 'period'>,
    period: string,
    parts: boolean,
    language: string | undefined
): string | undefined {
    if (!validSubjects(intent) || (language !== undefined && !validLanguage(language))) {
        return undefined;
    }
    const flags =
        (intent.monthly ? '1' : '0') +
        VIEW_CODES[intent.view ?? 'none'] +
        CHART_CODES[intent.chart ?? 'auto'] +
        (intent.compareWith === 'year_earlier' ? YEAR_EARLIER_CODE : '');
    const { alongside, target } = intent;
    const alongsideText = alongside
        ?.map(subject =>
            subject.target === undefined ? subject.root : `${subject.target}:${subject.root}`
        )
        .join(',');
    const subjects =
        parts || alongsideText !== undefined
            ? [alongsideText ?? '', target ?? '']
            : target !== undefined
              ? [target]
              : [];
    const text = [
        flags,
        period,
        language ?? '',
        // No hashtags and an empty list are alike.
        (intent.hashtags ?? []).join(','),
        ...subjects,
        intent.root,
    ].join('.');
    const bytes = utf8(text);
    const version = parts
        ? PARTS_VERSION
        : alongside !== undefined
          ? ALONGSIDE_VERSION
          : target === undefined
            ? VERSION
            : TARGET_VERSION;
    const state = bytes && version + toBase64url(bytes);
    return state && state.length <= MAX_STATE_LENGTH ? state : undefined;
}

/** The report a state names, or `undefined` for anything but a state this module wrote. */
export function decodeReportState(state: string): ReportState | undefined {
    const version = state[0];
    const count = Object.hasOwn(FIELDS, version) ? FIELDS[version] : undefined;
    if (!STATE_PATTERN.test(state) || count === undefined) {
        return undefined;
    }
    const bytes = fromBase64url(state.slice(1));
    const text = bytes && fromUtf8(bytes);
    if (text === undefined) return undefined;
    const fields: string[] = [];
    let rest = text;
    for (let index = 0; index < count; index++) {
        const dot = rest.indexOf('.');
        if (dot < 0) return undefined;
        fields.push(rest.slice(0, dot));
        rest = rest.slice(dot + 1);
    }
    const [flags, period, language, hashtags, ...subjects] = fields;
    const [alongside, target] =
        version === ALONGSIDE_VERSION || version === PARTS_VERSION
            ? [subjects[0] || undefined, subjects[1] || undefined]
            : [undefined, subjects[0]];
    if (flags.length < 3 || flags.length > 4 || (flags[0] !== '0' && flags[0] !== '1')) {
        return undefined;
    }
    if (flags.length === 4 && flags[3] !== YEAR_EARLIER_CODE) return undefined;
    const view = codeOf(VIEW_CODES, flags[1]);
    const chart = codeOf(CHART_CODES, flags[2]);
    if (view === undefined || chart === undefined) return undefined;
    const intent = {
        root: rest,
        ...(target !== undefined ? { target } : {}),
        ...(alongside !== undefined ? { alongside: alongside.split(',').map(subjectOf) } : {}),
        monthly: flags[0] === '1',
        ...(flags.length === 4 ? { compareWith: 'year_earlier' as const } : {}),
        ...(view !== 'none' ? { view } : {}),
        ...(chart !== 'auto' ? { chart } : {}),
        ...(hashtags ? { hashtags: hashtags.split(',') } : {}),
    };
    const languageField = language ? { language } : {};
    if (version === PARTS_VERSION) {
        const parts = partsOf(period);
        const decoded: ReportState | undefined = parts && {
            intent: { ...intent, ...parts },
            ...languageField,
        };
        // One state per report: anything else, such as parts a period id says, is not one written here.
        return decoded && encodeReportState(decoded) === state ? decoded : undefined;
    }
    // A period id, written as before; one state per report, so it is written back the same.
    const withParts = PERIOD_ID_PATTERN.test(period)
        ? intentWithParts({ ...intent, period })
        : undefined;
    return withParts && writeState(intent, period, false, language || undefined) === state
        ? { intent: withParts, ...languageField }
        : undefined;
}

/** The code of a period's parts and of the compared ones, such as `yp__~2023__`. */
function partsCode({ period, compared }: Pick<ReportIntentData, 'period' | 'compared'>): string {
    const code = (parts: ComparedParts) =>
        (typeof parts.year === 'number' ? String(parts.year) : YEAR_CODES[parts.year ?? 'none']) +
        (typeof parts.month === 'number'
            ? MONTH_LETTERS[parts.month - 1]
            : UNIT_CODES[parts.month ?? 'none']) +
        (typeof parts.quarter === 'number'
            ? String(parts.quarter)
            : UNIT_CODES[parts.quarter ?? 'none']);
    return (
        SPAN_CODES[period.span ?? 'none'] +
        code(period) +
        (compared === undefined ? '' : COMPARED_CODE + code(compared))
    );
}

/** The parts of a period code, or `undefined` when it is none. */
function partsOf(text: string): Pick<ReportIntentData, 'period' | 'compared'> | undefined {
    const match = PARTS_PATTERN.exec(text);
    if (!match) return undefined;
    const [, span, year, month, quarter, comparedYear, comparedMonth, comparedQuarter] = match;
    const parts = (yearCode: string, monthCode: string, quarterCode: string): ComparedParts => {
        const yearPart = /^\d{4}$/.test(yearCode) ? Number(yearCode) : codeOf(YEAR_CODES, yearCode);
        const monthIndex = MONTH_LETTERS.indexOf(monthCode);
        const monthPart =
            monthIndex >= 0 ? MONTHS_OF_YEAR[monthIndex] : codeOf(UNIT_CODES, monthCode);
        const quarterPart = /^[1-4]$/.test(quarterCode)
            ? QUARTERS_OF_YEAR[Number(quarterCode) - 1]
            : codeOf(UNIT_CODES, quarterCode);
        return {
            ...(yearPart !== undefined && yearPart !== 'none' ? { year: yearPart } : {}),
            ...(monthPart !== undefined && monthPart !== 'none' ? { month: monthPart } : {}),
            ...(quarterPart !== undefined && quarterPart !== 'none'
                ? { quarter: quarterPart }
                : {}),
        };
    };
    const spanPart = codeOf(SPAN_CODES, span);
    return {
        period: {
            ...(spanPart !== undefined && spanPart !== 'none' ? { span: spanPart } : {}),
            ...parts(year, month, quarter),
        },
        ...(comparedYear !== undefined
            ? { compared: parts(comparedYear, comparedMonth, comparedQuarter) }
            : {}),
    };
}

/**
 * The state in a URL's parameter: none when it is missing, empty or the menu URL's expression
 * left unreplaced, as older Bkper versions do.
 */
export function stateFromUrlValue(value: string | null | undefined): string | undefined {
    return value && value !== STATE_EXPRESSION ? value : undefined;
}

/**
 * The request a report answers, as plain words: its title and its period as asked, so editing
 * it keeps a relative period relative; for a spec written before it said so, its title and the
 * period it read.
 */
export function reportText(spec: ReportSpec): string {
    const root = spec.elements[spec.root];
    return root?.type === 'Report'
        ? withoutIsolates(root.props.request ?? `${root.props.title} ${root.props.subtitle}`).trim()
        : '';
}

/** A target alongside the first, as written: `<root>` or `<target>:<root>`. */
function subjectOf(text: string): ReportSubjectData {
    const colon = text.indexOf(':');
    return colon < 0
        ? { root: text }
        : { root: text.slice(colon + 1), target: text.slice(0, colon) };
}

/** An id written between separators: never one of them. */
function validId(id: string, separators: string): boolean {
    return (
        id.length > 0 &&
        id.length <= MAX_ROOT_LENGTH &&
        [...separators].every(separator => !id.includes(separator))
    );
}

/** Whether the root, the targets and the hashtags of an intent can be written. */
function validSubjects(intent: Omit<ReportIntentData, 'period'>): boolean {
    const { root, target, alongside, hashtags } = intent;
    return (
        root.length > 0 &&
        root.length <= MAX_ROOT_LENGTH &&
        (target === undefined || validId(target, '.')) &&
        (alongside === undefined ||
            (alongside.length > 0 &&
                alongside.length <= MAX_ALONGSIDE &&
                alongside.every(
                    subject =>
                        validId(subject.root, '.,:') &&
                        (subject.target === undefined || validId(subject.target, '.,:'))
                ))) &&
        (hashtags === undefined ||
            (hashtags.length <= MAX_HASHTAGS &&
                hashtags.every(
                    tag => tag.length <= MAX_HASHTAG_LENGTH && HASHTAG_PATTERN.test(tag)
                )))
    );
}

function validLanguage(language: string): boolean {
    return supportedLanguage(language) === language;
}

function codeOf<T extends string>(codes: Record<T, string>, code: string): T | undefined {
    return (Object.keys(codes) as T[]).find(value => codes[value] === code);
}

/** The UTF-8 bytes of a text; `undefined` for one with a lone surrogate. */
function utf8(text: string): number[] | undefined {
    let escaped: string;
    try {
        escaped = encodeURIComponent(text);
    } catch {
        return undefined;
    }
    return [...escaped.matchAll(/%([0-9A-F]{2})|./g)].map(([char, hex]) =>
        hex ? parseInt(hex, 16) : char.charCodeAt(0)
    );
}

/** The text of UTF-8 bytes; `undefined` when they are not valid UTF-8. */
function fromUtf8(bytes: number[]): string | undefined {
    try {
        return decodeURIComponent(
            bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')
        );
    } catch {
        return undefined;
    }
}

function toBase64url(bytes: number[]): string {
    let out = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const chunk =
            (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
        const chars = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
        for (let char = 0; char < chars; char++) {
            out += BASE64URL[(chunk >> (18 - 6 * char)) & 63];
        }
    }
    return out;
}

function fromBase64url(text: string): number[] | undefined {
    if (text.length % 4 === 1) return undefined;
    const bytes: number[] = [];
    for (let index = 0; index < text.length; index += 4) {
        const group = text.slice(index, index + 4);
        let chunk = 0;
        for (let char = 0; char < 4; char++) {
            const value = char < group.length ? BASE64URL.indexOf(group[char]) : 0;
            if (value < 0) return undefined;
            chunk |= value << (18 - 6 * char);
        }
        for (let byte = 0; byte < group.length - 1; byte++) {
            bytes.push((chunk >> (16 - 8 * byte)) & 255);
        }
    }
    return bytes;
}
