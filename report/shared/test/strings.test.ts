import { describe, expect, it } from 'vitest';
import en from '../catalog/en.json';
import { STRING_KEYS, addLocale, t, textDirection } from '../src/strings';

describe('t', () => {
    it('reads the English text', () => {
        expect(t('row_other', 'en')).toBe('Other');
    });

    it('reads a language that has the key', () => {
        addLocale('pt', { row_other: 'Outros' });
        expect(t('row_other', 'pt')).toBe('Outros');
    });

    it('falls back to English for a language without the key or without strings', () => {
        addLocale('es', { row_other: 'Otros' });
        expect(t('row_incoming', 'es')).toBe('Incoming');
        expect(t('row_other', 'sw')).toBe('Other');
    });

    it('falls back to English for an empty translation', () => {
        addLocale('fr', { row_other: '  ' });
        expect(t('row_other', 'fr')).toBe('Other');
    });

    it('falls back from a regional language to its base language', () => {
        addLocale('de', { row_other: 'Sonstige' });
        expect(t('row_other', 'de-AT')).toBe('Sonstige');
    });

    it('prefers the regional language when it has the key', () => {
        addLocale('zh-CN', { row_other: '其他' });
        addLocale('zh-TW', { row_other: '其他項目' });
        expect(t('row_other', 'zh-TW')).toBe('其他項目');
    });

    it('fills every placeholder, wherever the translation puts it', () => {
        expect(t('report_document_title', 'en', { report: 'Expenses', book: 'Nimbus' })).toBe(
            'Expenses · Nimbus'
        );
        addLocale('ja', { period_quarter: '{year}年第{quarter}四半期' });
        expect(t('period_quarter', 'ja', { quarter: '3', year: '2026' })).toBe('2026年第3四半期');
    });

    it('fills a value verbatim, even when it looks like a placeholder', () => {
        expect(t('source_footer', 'en', { book: '{book} $& Co' })).toBe(
            'Computed from the balances of {book} $& Co'
        );
    });

    it('keeps a placeholder without a value visible', () => {
        expect(t('suggestion_breakdown_year', 'en', { root: 'Assets' })).toBe('Assets in {year}');
    });
});

describe('textDirection', () => {
    it('is right to left for right-to-left scripts', () => {
        expect(textDirection('ar')).toBe('rtl');
        expect(textDirection('he')).toBe('rtl');
        expect(textDirection('fa-IR')).toBe('rtl');
    });

    it('is left to right otherwise', () => {
        expect(textDirection('en')).toBe('ltr');
        expect(textDirection('ja')).toBe('ltr');
    });
});

describe('English catalog', () => {
    const entries = Object.entries(en) as [string, Record<string, unknown>][];

    it('describes every string with its text, role and context', () => {
        expect(STRING_KEYS.length).toBe(entries.length);
        for (const [key, entry] of entries) {
            expect(key).toMatch(/^[a-z0-9_]+$/);
            expect(typeof entry.text, key).toBe('string');
            expect(typeof entry.role, key).toBe('string');
            expect(String(entry.context).length, key).toBeGreaterThan(20);
        }
    });

    it('documents exactly the placeholders each text uses', () => {
        for (const [key, entry] of entries) {
            const used = [...String(entry.text).matchAll(/\{(\w+)\}/g)].map(match => match[1]);
            const documented = Object.keys((entry.placeholders as object | undefined) ?? {});
            expect(documented.sort(), key).toEqual([...new Set(used)].sort());
        }
    });
});
