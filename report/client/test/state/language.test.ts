import { describe, expect, it } from 'vitest';
import { personLanguage } from '../../src/state/language';

describe('personLanguage', () => {
    it('follows the language the person chose in Bkper over the browser', () => {
        expect(personLanguage('theme=dark; bkper_language=pt', ['en-US', 'en'])).toBe('pt');
    });

    it('reads a chosen language with a region as Bkper names it', () => {
        expect(personLanguage('bkper_language=zh-TW', ['en'])).toBe(personLanguage('', ['zh-TW']));
    });

    it("uses the browser's first supported language without a choice", () => {
        expect(personLanguage('', ['x-unknown', 'es-AR', 'en'])).toBe('es');
    });

    it('ignores a choice that is not a supported language', () => {
        expect(personLanguage('bkper_language=%E0%A4%A', ['fr-FR'])).toBe('fr');
        expect(personLanguage('bkper_language=klingon', ['fr-FR'])).toBe('fr');
    });

    it('falls back to English', () => {
        expect(personLanguage('', [])).toBe('en');
    });
});
