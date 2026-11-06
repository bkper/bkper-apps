import { describe, expect, it } from 'vitest';
import { LANGUAGES, supportedLanguage } from '../src/languages';

describe('LANGUAGES', () => {
    it('lists the 133 Bkper languages once each, with both names', () => {
        expect(LANGUAGES).toHaveLength(133);
        expect(new Set(LANGUAGES.map(language => language.code)).size).toBe(133);
        for (const language of LANGUAGES) {
            expect(language.name.trim(), language.code).not.toBe('');
            expect(language.english.trim(), language.code).not.toBe('');
        }
    });

    it('tells the two written forms of Chinese apart', () => {
        const english = (code: string) => LANGUAGES.find(l => l.code === code)?.english;
        expect(english('zh-CN')).toBe('Chinese (Simplified)');
        expect(english('zh-TW')).toBe('Chinese (Traditional)');
    });
});

describe('supportedLanguage', () => {
    it('maps a BCP 47 tag to the Bkper language it is written in', () => {
        expect(supportedLanguage('pt')).toBe('pt');
        expect(supportedLanguage('PT-br')).toBe('pt');
        expect(supportedLanguage('en-GB')).toBe('en');
        expect(supportedLanguage('mni-Mtei')).toBe('mni-Mtei');
        expect(supportedLanguage('mni')).toBe('mni-Mtei');
    });

    it('tells Simplified from Traditional Chinese by script or region', () => {
        expect(supportedLanguage('zh')).toBe('zh-CN');
        expect(supportedLanguage('zh-Hans-HK')).toBe('zh-CN');
        expect(supportedLanguage('zh-tw')).toBe('zh-TW');
        expect(supportedLanguage('zh-HK')).toBe('zh-TW');
        expect(supportedLanguage('zh-Hant')).toBe('zh-TW');
    });

    it('reads other codes of the same language', () => {
        expect(supportedLanguage('iw')).toBe('he');
        expect(supportedLanguage('fil')).toBe('tl');
        expect(supportedLanguage('nb-NO')).toBe('no');
    });

    it('rejects tags that are not BCP 47 or not a Bkper language', () => {
        expect(supportedLanguage('')).toBeUndefined();
        expect(supportedLanguage('not a tag')).toBeUndefined();
        expect(supportedLanguage('tlh')).toBeUndefined();
        expect(supportedLanguage('*')).toBeUndefined();
    });
});
