/**
 * A report's state in a URL: the opaque app state Bkper keeps in a Book's URL (`appState`, at
 * most {@link MAX_STATE_LENGTH} letters, digits, `_` and `-`), so a link, Back or a reload opens
 * the same report again, by asking for its text.
 *
 * The state holds what a person would send to ask for the report: its own text (the response's
 * `text`, which, sent back as a prompt, asks for the same report), the language of its texts
 * (read from a short text, the language can be unsure) and the chart it shows, which the app
 * shows again when the report offers it: the chart is the app's, never asked for. It is a version, then the base64url of the UTF-8 of
 * `<language>.<chart>.<text>`: the chart empty for none, and the text last, so it may hold
 * anything. A state longer than Bkper keeps is no state.
 */
import { supportedLanguage } from './languages';
import { REPORT_CHARTS, type ChartPreference } from './report-intent';

/** The longest app state Bkper keeps. */
export const MAX_STATE_LENGTH = 1024;

/** The longest request a report accepts, in UTF-16 code units, once trimmed. */
export const MAX_PROMPT_LENGTH = 1000;

/** What Bkper accepts as app state, but empty. */
const STATE_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The menu URL's expression, which older Bkper versions leave in the URL unreplaced. */
const STATE_EXPRESSION = '${app.state}';

/**
 * The version of a state of a report's text. States of other versions, such as the compact
 * intents written before, are no state.
 */
const VERSION = '5';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A chart to ask for: `auto`, the report's own choice, is asking for none. */
export type StateChart = Exclude<ChartPreference, 'auto'>;

/** A report to open again: what to ask for it. */
export interface UrlState {
    /** The report's own text, sent as the prompt. */
    text: string;
    /** The language of the report's texts. */
    language: string;
    /** The chart to show, when the report offers it; left out, the report's own. */
    chart?: StateChart;
}

/**
 * The state of a report, or `undefined` when it is longer than Bkper keeps or is not one
 * {@link decodeUrlState} would open: an empty or untrimmed text, one longer than a request, an
 * unknown language or chart.
 */
export function encodeUrlState({ text, language, chart }: UrlState): string | undefined {
    if (!validText(text) || supportedLanguage(language) !== language) return undefined;
    if (chart !== undefined && !isStateChart(chart)) return undefined;
    const bytes = utf8(`${language}.${chart ?? ''}.${text}`);
    const state = bytes && VERSION + toBase64url(bytes);
    return state && state.length <= MAX_STATE_LENGTH ? state : undefined;
}

/** The report a state names, or `undefined` for anything but a state this module wrote. */
export function decodeUrlState(state: string): UrlState | undefined {
    if (state.length > MAX_STATE_LENGTH || !STATE_PATTERN.test(state) || state[0] !== VERSION) {
        return undefined;
    }
    const bytes = fromBase64url(state.slice(1));
    const decoded = bytes && fromUtf8(bytes);
    if (decoded === undefined) return undefined;
    const [language, chart, ...rest] = decoded.split('.');
    if (rest.length === 0 || (chart !== '' && !isStateChart(chart))) return undefined;
    const value: UrlState = {
        text: rest.join('.'),
        language,
        ...(chart ? { chart } : {}),
    };
    // One state per report: anything else is not one written here.
    return encodeUrlState(value) === state ? value : undefined;
}

/**
 * The state in a URL's parameter: none when it is missing, empty or the menu URL's expression
 * left unreplaced, as older Bkper versions do.
 */
export function stateFromUrlValue(value: string | null | undefined): string | undefined {
    return value && value !== STATE_EXPRESSION ? value : undefined;
}

function validText(text: string): boolean {
    return text.length > 0 && text.length <= MAX_PROMPT_LENGTH && text === text.trim();
}

function isStateChart(chart: string): chart is StateChart {
    return chart !== 'auto' && (REPORT_CHARTS as readonly string[]).includes(chart);
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
