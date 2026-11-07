import { describe, expect, it } from 'vitest';
import en from '../catalog/en.json';
import englishLocale from '../locales/en.json';
import { LANGUAGES } from '../src/languages';
import { loadLocale } from '../src/locale-loader';
import { LOCALES } from '../src/locales';
import { STRING_KEYS, t, textDirection } from '../src/strings';

const PRODUCT_NAME = 'Bkper';
/** A text in quotes from start to end; a quoted name may still end a sentence, as in Russian. */
const QUOTED = /^["'“”„‘’‚«»‹›「」『』].*["'“”„‘’‚«»‹›「」『』]$/u;

/** `locales/{code}.json`, as the Worker imports it. */
function readLocale(code: string): Record<string, string> {
    const locale = LOCALES[code];
    expect(locale, `locales/${code}.json`).toBeDefined();
    return { ...locale };
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/\{[^{}]*\}/g)].map(match => match[0]).sort();
}

const translated = LANGUAGES.filter(language => language.code !== 'en');

describe('locales', () => {
    it('has the English of the catalog', () => {
        expect(englishLocale).toEqual(
            Object.fromEntries(STRING_KEYS.map(key => [key, en[key].text]))
        );
    });

    it.each(translated.map(language => language.code))('%s has every key and only those', code => {
        expect(Object.keys(readLocale(code)).sort()).toEqual([...STRING_KEYS].sort());
    });

    it.each(translated.map(language => language.code))(
        '%s keeps the placeholders and the product name, with clean values',
        code => {
            const locale = readLocale(code);
            for (const key of STRING_KEYS) {
                const english = en[key].text;
                const text = locale[key] ?? '';
                const where = `${code} ${key}: ${text}`;
                expect(text.trim(), where).not.toBe('');
                expect(text, where).toBe(text.trim());
                expect(placeholders(text), where).toEqual(placeholders(english));
                if (english.includes(PRODUCT_NAME)) expect(text, where).toContain(PRODUCT_NAME);
                expect(text, where).not.toMatch(QUOTED);
                expect(text, where).not.toMatch(/[\r\n]/);
                // Longer than this, a value holds an explanation or alternatives.
                expect([...text].length, where).toBeLessThanOrEqual(3 * [...english].length + 20);
            }
        }
    );

    it('are all loaded by the Worker, English being the catalog itself', () => {
        expect(Object.keys(LOCALES).sort()).toEqual(translated.map(l => l.code).sort());
    });

    it('load one language at a time in the browser', async () => {
        await loadLocale('sw');
        expect(t('chart_name_pie', 'sw')).toBe(readLocale('sw').chart_name_pie);
        await loadLocale('en');
        expect(t('chart_name_pie', 'en')).toBe('Pie');
    });
});

/** Scripts written right to left, by ISO 15924 code. */
const RIGHT_TO_LEFT_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg']);

describe('text direction of the Bkper languages', () => {
    it.each(LANGUAGES.map(language => language.code))('%s follows its script', code => {
        const script = new Intl.Locale(code).maximize().script ?? '';
        expect(textDirection(code)).toBe(RIGHT_TO_LEFT_SCRIPTS.has(script) ? 'rtl' : 'ltr');
    });
});
