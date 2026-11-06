import { describe, expect, it } from 'vitest';
import type { BookListItem } from '../../src/services/book-service';
import { findBooks } from '../../src/state/books';

const books: BookListItem[] = [
    { id: '1', name: 'Nimbus Financeiro' },
    { id: '2', name: 'Personal finances' },
    { id: '3', name: 'Câmbio 2024' },
    { id: '4', name: 'Studio Norte' },
    { id: '5', name: 'Finanças da Casa' },
];

const ids = (found: BookListItem[]) => found.map(book => book.id);

describe('findBooks', () => {
    it('shows the first Books, the most recent, without a filter', () => {
        expect(ids(findBooks(books, '', 3))).toEqual(['1', '2', '3']);
        expect(ids(findBooks(books, '   ', 2))).toEqual(['1', '2']);
    });

    it('finds Books among all of them by every word typed, in their order', () => {
        expect(ids(findBooks(books, 'finan', 3))).toEqual(['1', '2', '5']);
        expect(ids(findBooks(books, 'norte stu', 3))).toEqual(['4']);
        expect(ids(findBooks(books, 'finan', 2))).toEqual(['1', '2']);
    });

    it('ignores case and accents', () => {
        expect(ids(findBooks(books, 'CAMBIO', 3))).toEqual(['3']);
        expect(ids(findBooks(books, 'financas', 3))).toEqual(['5']);
    });

    it('finds nothing when no Book has every word', () => {
        expect(findBooks(books, 'nimbus personal', 3)).toEqual([]);
    });
});
