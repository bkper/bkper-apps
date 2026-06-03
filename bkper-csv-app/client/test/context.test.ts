import { describe, expect, it } from 'bun:test';
import { getMenuContext } from '../src/context';

describe('menu context', () => {
    it('reads the book and current transaction query from menu URL params', () => {
        const context = getMenuContext('?bookId=book-123&query=account%3ABank+after%3A2026');

        expect(context).toEqual({
            bookId: 'book-123',
            query: 'account:Bank after:2026',
        });
    });

    it('supports the legacy ledgerId parameter as a book id fallback', () => {
        expect(getMenuContext('?ledgerId=legacy-book').bookId).toBe('legacy-book');
    });

    it('normalizes missing query values to an empty query', () => {
        expect(getMenuContext('?bookId=book-123').query).toBe('');
        expect(getMenuContext('?bookId=book-123&query=undefined').query).toBe('');
    });
});
