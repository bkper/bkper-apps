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
 * their ids cannot hold a `.`, `,` or `:`. Every other report keeps version `1`, so states
 * written before open the same report.
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
    PERIOD_ID_PATTERN,
    type ChartPreference,
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

/** The version of a state without a target, of one with a target, and of targets side by side. */
const VERSION = '1';
const TARGET_VERSION = '2';
const ALONGSIDE_VERSION = '3';

/** The fields before the root, in each version. */
const FIELDS: Record<string, number> = {
    [VERSION]: 4,
    [TARGET_VERSION]: 5,
    [ALONGSIDE_VERSION]: 6,
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
    if (!validIntent(intent) || (language !== undefined && !validLanguage(language))) {
        return undefined;
    }
    const flags =
        (intent.monthly ? '1' : '0') +
        VIEW_CODES[intent.view ?? 'none'] +
        CHART_CODES[intent.chart ?? 'auto'] +
        (intent.compareWith === 'year_earlier' ? YEAR_EARLIER_CODE : '');
    const { alongside, target } = intent;
    const text = [
        flags,
        intent.period,
        language ?? '',
        // No hashtags and an empty list are alike.
        (intent.hashtags ?? []).join(','),
        ...(alongside === undefined
            ? []
            : [
                  alongside
                      .map(subject =>
                          subject.target === undefined
                              ? subject.root
                              : `${subject.target}:${subject.root}`
                      )
                      .join(','),
                  target ?? '',
              ]),
        ...(alongside === undefined && target !== undefined ? [target] : []),
        intent.root,
    ].join('.');
    const bytes = utf8(text);
    const version =
        alongside !== undefined
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
        version === ALONGSIDE_VERSION
            ? [subjects[0], subjects[1] || undefined]
            : [undefined, subjects[0]];
    if (flags.length < 3 || flags.length > 4 || (flags[0] !== '0' && flags[0] !== '1')) {
        return undefined;
    }
    if (flags.length === 4 && flags[3] !== YEAR_EARLIER_CODE) return undefined;
    const view = codeOf(VIEW_CODES, flags[1]);
    const chart = codeOf(CHART_CODES, flags[2]);
    if (view === undefined || chart === undefined) return undefined;
    const intent: ReportIntentData = {
        root: rest,
        ...(target !== undefined ? { target } : {}),
        ...(alongside !== undefined ? { alongside: alongside.split(',').map(subjectOf) } : {}),
        period,
        monthly: flags[0] === '1',
        ...(flags.length === 4 ? { compareWith: 'year_earlier' as const } : {}),
        ...(view !== 'none' ? { view } : {}),
        ...(chart !== 'auto' ? { chart } : {}),
        ...(hashtags ? { hashtags: hashtags.split(',') } : {}),
    };
    const decoded: ReportState = { intent, ...(language ? { language } : {}) };
    // One state per report: anything else, such as other padding bits, is not one written here.
    return encodeReportState(decoded) === state ? decoded : undefined;
}

/**
 * The state in a URL's parameter: none when it is missing, empty or the menu URL's expression
 * left unreplaced, as older Bkper versions do.
 */
export function stateFromUrlValue(value: string | null | undefined): string | undefined {
    return value && value !== STATE_EXPRESSION ? value : undefined;
}

/** The report's title and period, which read like the request for it, as plain words. */
export function reportText(spec: ReportSpec): string {
    const root = spec.elements[spec.root];
    return root?.type === 'Report'
        ? withoutIsolates(`${root.props.title} ${root.props.subtitle}`).trim()
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

function validIntent(intent: ReportIntentData): boolean {
    const { root, target, alongside, period, hashtags } = intent;
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
        PERIOD_ID_PATTERN.test(period) &&
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
