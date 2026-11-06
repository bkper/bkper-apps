import type WaInput from '@awesome.me/webawesome-pro/dist/components/input/input.js';
import { addLocale, t } from 'report-shared/strings';
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/web-awesome';
import { BookPicker, CHOOSE_BOOK, RECENT_BOOKS } from '../../src/components/book-picker';
import type { BookListItem } from '../../src/services/book-service';

/** Books from the most recent; some share words, one has no name. */
const BOOKS: BookListItem[] = Array.from({ length: 30 }, (_, index) => ({
    id: `book-${index}`,
    name: index === 3 ? '' : index % 10 === 7 ? `Finanças ${index}` : `Ledger ${index}`,
}));

async function mount(books = BOOKS, language = 'en'): Promise<BookPicker> {
    const picker = new BookPicker();
    picker.books = books;
    picker.language = language;
    document.body.append(picker);
    await picker.updateComplete;
    return picker;
}

function shadow(picker: BookPicker): ShadowRoot {
    if (!picker.shadowRoot) throw new Error('The picker has not rendered');
    return picker.shadowRoot;
}

function names(picker: BookPicker): string[] {
    return [...shadow(picker).querySelectorAll('.book')].map(
        button => button.textContent?.trim() ?? ''
    );
}

async function type(picker: BookPicker, text: string): Promise<WaInput> {
    const input = shadow(picker).querySelector('wa-input');
    if (!input) throw new Error('No filter');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await picker.updateComplete;
    return input;
}

describe('BookPicker', () => {
    afterEach(() => document.body.replaceChildren());

    it('shows the most recent Books under a title, each to open', async () => {
        const picker = await mount();

        expect(shadow(picker).querySelector('h1')?.textContent).toBe(t('book_picker_title', 'en'));
        expect(names(picker)).toHaveLength(RECENT_BOOKS);
        expect(names(picker).slice(0, 3)).toEqual(['Ledger 0', 'Ledger 1', 'Ledger 2']);
        expect(names(picker)[3]).toBe(t('book_untitled', 'en'));
        expect(shadow(picker).textContent).not.toMatch(/Hello|Open/);
    });

    it('finds any Book by name as the person types, and opens the first on Enter', async () => {
        const picker = await mount();
        const chosen: string[] = [];
        picker.addEventListener(CHOOSE_BOOK, event => chosen.push(event.detail));

        const input = await type(picker, 'financas');
        expect(names(picker)).toEqual(['Finanças 7', 'Finanças 17', 'Finanças 27']);

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        [...shadow(picker).querySelectorAll<HTMLElement>('.book')].at(-1)?.click();
        expect(chosen).toEqual(['book-7', 'book-27']);
    });

    it('says when no Book matches', async () => {
        const picker = await mount();

        await type(picker, 'nothing like it');

        expect(names(picker)).toEqual([]);
        expect(shadow(picker).textContent).toContain(t('book_picker_no_match', 'en'));
    });

    it('needs no filter for a few Books, and says when there are none', async () => {
        const few = await mount(BOOKS.slice(0, 2));
        expect(shadow(few).querySelector('wa-input')).toBeNull();
        expect(names(few)).toEqual(['Ledger 0', 'Ledger 1']);

        const none = await mount([]);
        expect(shadow(none).textContent).toContain(t('book_picker_empty', 'en'));
    });

    it('writes every text in the language of the interface', async () => {
        addLocale('pt', {
            book_picker_title: 'Escolha um Livro',
            book_picker_filter: 'Encontre um Livro',
            book_untitled: 'Livro sem nome',
        });
        const picker = await mount(BOOKS, 'pt');

        expect(shadow(picker).querySelector('h1')?.textContent).toBe('Escolha um Livro');
        expect(shadow(picker).querySelector('wa-input')?.getAttribute('placeholder')).toBe(
            'Encontre um Livro'
        );
        expect(names(picker)[3]).toBe('Livro sem nome');
    });
});
