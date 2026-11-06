import { addLocale } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { Strings } from '../../src/state/strings';

describe('Strings', () => {
    it('shows English until the strings of the language load, then that language', async () => {
        let finish: () => void = () => undefined;
        const asked: string[] = [];
        const strings = new Strings('pt', lang => {
            asked.push(lang);
            return new Promise(resolve => (finish = resolve));
        });
        let changes = 0;
        strings.addEventListener('change', () => changes++);

        const loading = strings.load();
        expect(strings.language).toBe('en');
        finish();
        await loading;

        expect(strings.language).toBe('pt');
        expect(changes).toBe(1);
        expect(asked).toEqual(['pt']);
    });

    it('loads the strings once', async () => {
        let loads = 0;
        const strings = new Strings('ja', async () => void loads++);

        await Promise.all([strings.load(), strings.load()]);
        await strings.load();

        expect(loads).toBe(1);
    });

    it('stays in English when the strings fail to load, and tries again next time', async () => {
        let fail = true;
        const strings = new Strings('sw', async lang => {
            if (fail) throw new Error('offline');
            addLocale(lang, {});
        });

        await expect(strings.load()).rejects.toThrow('offline');
        expect(strings.language).toBe('en');

        fail = false;
        await strings.load();
        expect(strings.language).toBe('sw');
    });

    it('loads the real strings of a language by default', async () => {
        const strings = new Strings('es');
        await strings.load();
        expect(strings.language).toBe('es');
    });
});
