import { describe, expect, it } from 'bun:test';
import { getMenuContext } from '../src/app/menu-context';

describe('sidebar menu context', () => {
    it('captures the original query and most-specific learning context IDs', () => {
        expect(
            getMenuContext(
                '?bookId=book&query=account%3ABank%20after%3A2026-01-01&accountId=account&groupId=group'
            )
        ).toEqual({
            bookId: 'book',
            query: 'account:Bank after:2026-01-01',
            accountId: 'account',
            groupId: 'group',
        });
    });

    it('normalizes unresolved optional menu expressions without changing a real query', () => {
        expect(
            getMenuContext(
                '?bookId=book&query=%24%7Btransactions.query%7D&accountId=%24%7Baccount.id%7D'
            )
        ).toEqual({ bookId: 'book', query: '', accountId: null, groupId: null });
    });
});
