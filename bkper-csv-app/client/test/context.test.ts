import { describe, expect, it } from 'bun:test';
import { getAppUrlChange, getMenuContext } from '../src/context';

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

    it('normalizes missing query values to all transactions', () => {
        expect(getMenuContext('?bookId=book-123').query).toBe('');
        expect(getMenuContext('?bookId=book-123&query=undefined').query).toBe('');
        expect(getMenuContext('?bookId=book-123&query=null').query).toBe('');
        expect(getMenuContext('?bookId=book-123&query=%24%7Btransactions.query%7D').query).toBe('');
    });

    it('accepts trusted live app URL updates for this app origin', () => {
        const parent = {};
        const nextUrl = getAppUrlChange(
            {
                source: parent,
                origin: 'https://bkper.app',
                data: {
                    type: 'bkper:app-url-changed',
                    url: 'http://localhost:5176/?bookId=book-456&query=is%3Achecked',
                },
            },
            {
                parent,
                bkperOrigin: 'https://bkper.app',
                appOrigin: 'http://localhost:5176',
            }
        );

        expect(nextUrl?.searchParams.get('bookId')).toBe('book-456');
        expect(nextUrl?.searchParams.get('query')).toBe('is:checked');
    });

    it('rejects untrusted or malformed live app URL updates', () => {
        const parent = {};
        const expectedContext = {
            parent,
            bkperOrigin: 'https://bkper.app',
            appOrigin: 'http://localhost:5176',
        };

        expect(
            getAppUrlChange(
                {
                    source: {},
                    origin: 'https://bkper.app',
                    data: {
                        type: 'bkper:app-url-changed',
                        url: 'http://localhost:5176/?bookId=book-456',
                    },
                },
                expectedContext
            )
        ).toBeNull();
        expect(
            getAppUrlChange(
                {
                    source: parent,
                    origin: 'https://evil.example',
                    data: {
                        type: 'bkper:app-url-changed',
                        url: 'http://localhost:5176/?bookId=book-456',
                    },
                },
                expectedContext
            )
        ).toBeNull();
        expect(
            getAppUrlChange(
                {
                    source: parent,
                    origin: 'https://bkper.app',
                    data: {
                        type: 'bkper:app-url-changed',
                        url: 'https://evil.example/?bookId=book-456',
                    },
                },
                expectedContext
            )
        ).toBeNull();
        expect(
            getAppUrlChange(
                {
                    source: parent,
                    origin: 'https://bkper.app',
                    data: { type: 'other', url: 'not a URL' },
                },
                expectedContext
            )
        ).toBeNull();
    });
});
