/**
 * The app's interface and report strings.
 *
 * `catalog/en.json` holds each string's English text with the role, context and placeholders
 * a translator needs. Other languages are flat `key → text` maps, added with {@link addLocale}.
 * A placeholder is a `{name}` in the text, filled verbatim from the params of {@link t};
 * numbers and dates are formatted before they are passed in.
 */
import en from '../catalog/en.json';

export type StringKey = keyof typeof en;

/** The translations of one language; a missing or blank text falls back to English. */
export type Messages = Partial<Record<StringKey, string>>;

export const STRING_KEYS = Object.keys(en) as StringKey[];

const locales = new Map<string, Messages>();

/** Makes a language's strings available to {@link t}, replacing any added before. */
export function addLocale(lang: string, messages: Messages): void {
    locales.set(lang.toLowerCase(), messages);
}

/**
 * The text of a key in a language, its regional language falling back to its base language
 * (`pt-BR` to `pt`), then to English. Placeholders without a value stay visible.
 */
export function t(key: StringKey, lang: string, params: Record<string, string> = {}): string {
    const text = candidates(lang)
        .map(code => locales.get(code)?.[key])
        .find(value => value !== undefined && value.trim() !== '');
    return (text ?? en[key].text).replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        Object.hasOwn(params, name) ? params[name] : placeholder
    );
}

/** Languages, by their base language, written right to left. */
const RIGHT_TO_LEFT = new Set(['ar', 'ckb', 'dv', 'fa', 'he', 'iw', 'ps', 'sd', 'ug', 'ur', 'yi']);

export function textDirection(lang: string): 'ltr' | 'rtl' {
    return RIGHT_TO_LEFT.has(baseLanguage(lang)) ? 'rtl' : 'ltr';
}

function candidates(lang: string): string[] {
    const code = lang.toLowerCase();
    const base = baseLanguage(code);
    return base === code ? [code] : [code, base];
}

function baseLanguage(lang: string): string {
    return lang.toLowerCase().split(/[-_]/)[0];
}
