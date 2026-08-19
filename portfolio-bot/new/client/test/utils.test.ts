import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import { Utils } from '../src/utils.js';

describe('Utils', () => {
    it('uses explicit view and edit permission allowlists', () => {
        const cases = [
            { permission: Permission.OWNER, canView: true, canEdit: true },
            { permission: Permission.EDITOR, canView: true, canEdit: true },
            { permission: Permission.POSTER, canView: true, canEdit: false },
            { permission: Permission.VIEWER, canView: true, canEdit: false },
            { permission: Permission.RECORDER, canView: false, canEdit: false },
            { permission: Permission.NONE, canView: false, canEdit: false },
            { permission: undefined, canView: false, canEdit: false },
        ] as const;

        for (const permissionCase of cases) {
            const book = new Book({ id: 'book-id', permission: permissionCase.permission });
            expect(Utils.canViewBook(book)).toBe(permissionCase.canView);
            expect(Utils.canEditBook(book)).toBe(permissionCase.canEdit);
        }
    });

    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
