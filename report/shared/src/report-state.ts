/**
 * A report's compact state: its intent and language in at most {@link MAX_STATE_LENGTH}
 * letters, digits, `_` and `-`, the opaque app state Bkper keeps in a Book's URL
 * (`appState`), so a link, Back or a reload opens the same report again, by intent.
 *
 * The state names the root by its group id, which stays valid when the group is renamed. It
 * is a version, then the base64url of `<monthly><view><chart>.<period>.<language>.<hashtags>.<root>`:
 * one letter each for the month flag, the view and the chart, hashtags joined by `,` (neither
 * `.` nor `,` can be in a hashtag), and the root last, so it may hold anything.
 */
import type { ReportSpec } from './catalog';
import { withoutIsolates } from './bidi';
import { supportedLanguage } from './languages';
import {
    HASHTAG_PATTERN,
    MAX_HASHTAGS,
    MAX_HASHTAG_LENGTH,
    MAX_ROOT_LENGTH,
    PERIOD_ID_PATTERN,
    type ChartPreference,
    type ReportIntentData,
    type ReportView,
} from './report-intent';

/** The longest app state Bkper keeps. */
export const MAX_STATE_LENGTH = 128;

/** What Bkper accepts as app state. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The menu URL's expression, which older Bkper versions leave in the URL unreplaced. */
const STATE_EXPRESSION = '${app.state}';

const VERSION = '1';

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
        CHART_CODES[intent.chart ?? 'auto'];
    const text = [
        flags,
        intent.period,
        language ?? '',
        // No hashtags and an empty list are alike.
        (intent.hashtags ?? []).join(','),
        intent.root,
    ].join('.');
    const bytes = utf8(text);
    const state = bytes && VERSION + toBase64url(bytes);
    return state && state.length <= MAX_STATE_LENGTH ? state : undefined;
}

/** The report a state names, or `undefined` for anything but a state this module wrote. */
export function decodeReportState(state: string): ReportState | undefined {
    if (!STATE_PATTERN.test(state) || state[0] !== VERSION) return undefined;
    const bytes = fromBase64url(state.slice(1));
    const text = bytes && fromUtf8(bytes);
    if (text === undefined) return undefined;
    const fields: string[] = [];
    let rest = text;
    for (let index = 0; index < 4; index++) {
        const dot = rest.indexOf('.');
        if (dot < 0) return undefined;
        fields.push(rest.slice(0, dot));
        rest = rest.slice(dot + 1);
    }
    const [flags, period, language, hashtags] = fields;
    if (flags.length !== 3 || (flags[0] !== '0' && flags[0] !== '1')) return undefined;
    const view = codeOf(VIEW_CODES, flags[1]);
    const chart = codeOf(CHART_CODES, flags[2]);
    if (view === undefined || chart === undefined) return undefined;
    const intent: ReportIntentData = {
        root: rest,
        period,
        monthly: flags[0] === '1',
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

function validIntent(intent: ReportIntentData): boolean {
    const { root, period, hashtags } = intent;
    return (
        root.length > 0 &&
        root.length <= MAX_ROOT_LENGTH &&
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
