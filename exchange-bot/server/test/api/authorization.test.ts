import { describe, expect, test } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import { requireEditPermission, requireViewPermission } from '../../src/api/authorization.js';

const cases = [
    { permission: Permission.OWNER, canView: true, canEdit: true },
    { permission: Permission.EDITOR, canView: true, canEdit: true },
    { permission: Permission.POSTER, canView: true, canEdit: false },
    { permission: Permission.VIEWER, canView: true, canEdit: false },
    { permission: Permission.RECORDER, canView: false, canEdit: false },
    { permission: Permission.NONE, canView: false, canEdit: false },
    { permission: undefined, canView: false, canEdit: false },
] as const;

describe('API Book permissions', () => {
    test('uses explicit view and edit allowlists', () => {
        for (const { permission, canView, canEdit } of cases) {
            const book = new Book({ id: 'book-id', permission });

            if (canView) {
                expect(() => requireViewPermission(book)).not.toThrow();
            } else {
                expect(() => requireViewPermission(book)).toThrow();
            }

            if (canEdit) {
                expect(() => requireEditPermission(book)).not.toThrow();
            } else {
                expect(() => requireEditPermission(book)).toThrow();
            }
        }
    });

    test('describes the required and current Book permissions', () => {
        expectPermissionError(
            () => requireViewPermission(new Book({ permission: Permission.RECORDER })),
            'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.'
        );
        expectPermissionError(
            () => requireEditPermission(new Book({ permission: Permission.VIEWER })),
            'Required Book permission: EDITOR or OWNER. Current: VIEWER.'
        );
        expectPermissionError(
            () => requireEditPermission(new Book({})),
            'Required Book permission: EDITOR or OWNER. Current: unavailable.'
        );
    });
});

function expectPermissionError(action: () => void, message: string): void {
    try {
        action();
        throw new Error('Expected authorization to fail');
    } catch (error: unknown) {
        expect(error).toBeInstanceOf(HTTPException);
        if (error instanceof HTTPException) {
            expect(error.status).toBe(403);
            expect(error.message).toBe(message);
        }
    }
}
