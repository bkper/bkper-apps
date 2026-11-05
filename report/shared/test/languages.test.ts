import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/languages';

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
