import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import { Utils } from '../src/utils.js';

function createMessage(
    data: unknown,
    origin = 'https://bkper.app',
    source: unknown = self
): MessageEvent<unknown> {
    const event = new MessageEvent<unknown>('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

describe('Utils', () => {
    it('uses explicit view, edit, and owner permission checks', () => {
        const cases = [
            { permission: Permission.OWNER, canView: true, canEdit: true, isOwner: true },
            { permission: Permission.EDITOR, canView: true, canEdit: true, isOwner: false },
            { permission: Permission.POSTER, canView: true, canEdit: false, isOwner: false },
            { permission: Permission.VIEWER, canView: true, canEdit: false, isOwner: false },
            { permission: Permission.RECORDER, canView: false, canEdit: false, isOwner: false },
            { permission: Permission.NONE, canView: false, canEdit: false, isOwner: false },
            { permission: undefined, canView: false, canEdit: false, isOwner: false },
        ] as const;

        for (const permissionCase of cases) {
            const book = new Book({ id: 'book-id', permission: permissionCase.permission });
            expect(Utils.canViewBook(book)).toBe(permissionCase.canView);
            expect(Utils.canEditBook(book)).toBe(permissionCase.canEdit);
            expect(Utils.isBookOwner(book)).toBe(permissionCase.isOwner);
        }
    });

    it('accepts only trusted Bkper App URL change messages', () => {
        const url = 'https://inventory-bot.bkper.app/?bookId=book-id';
        const validMessage = { type: 'bkper:app-url-changed', url };
        const invalidEvents = [
            createMessage(validMessage, 'https://example.com'),
            createMessage(validMessage, 'https://bkper.app', null),
            createMessage(null),
            createMessage('message'),
            createMessage({}),
            createMessage({ type: 'other', url }),
            createMessage({ type: 'bkper:app-url-changed', url: 42 }),
        ];

        expect(
            Utils.isTrustedAppUrlChangeEvent(createMessage(validMessage), self, 'https://bkper.app')
        ).toBe(true);
        for (const event of invalidEvents) {
            expect(Utils.isTrustedAppUrlChangeEvent(event, self, 'https://bkper.app')).toBe(false);
        }
    });

    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
