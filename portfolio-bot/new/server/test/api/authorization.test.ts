import { describe, expect, test } from 'bun:test';
import { App, Book, Permission } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import {
    requireAppInstallation,
    requireEditPermission,
    requireViewPermission,
} from '../../src/api/authorization.js';

const cases = [
    { permission: Permission.OWNER, canView: true, canEdit: true },
    { permission: Permission.EDITOR, canView: true, canEdit: true },
    { permission: Permission.POSTER, canView: true, canEdit: false },
    { permission: Permission.VIEWER, canView: true, canEdit: false },
    { permission: Permission.RECORDER, canView: false, canEdit: false },
    { permission: Permission.NONE, canView: false, canEdit: false },
    { permission: undefined, canView: false, canEdit: false },
] as const;

describe('API Book authorization', () => {
    test('uses explicit view and edit permission allowlists', () => {
        for (const { permission, canView, canEdit } of cases) {
            const book = new Book({ id: 'book-id', permission });

            expectPermissionResult(() => requireViewPermission(book), canView);
            expectPermissionResult(() => requireEditPermission(book), canEdit);
        }
    });

    test('reports the accepted and current Book permissions', () => {
        const viewError = getHttpException(() =>
            requireViewPermission(new Book({ permission: Permission.RECORDER }))
        );
        expect(viewError.status).toBe(403);
        expect(viewError.message).toContain(Permission.VIEWER);
        expect(viewError.message).toContain(Permission.POSTER);
        expect(viewError.message).toContain(Permission.EDITOR);
        expect(viewError.message).toContain(Permission.OWNER);
        expect(viewError.message).toContain(Permission.RECORDER);

        const editError = getHttpException(() => requireEditPermission(new Book({})));
        expect(editError.status).toBe(403);
        expect(editError.message).toContain(Permission.EDITOR);
        expect(editError.message).toContain(Permission.OWNER);
        expect(editError.message).toContain('unavailable');
    });

    test('requires Portfolio Bot to be installed in the Book', async () => {
        const installedBook = new Book({ id: 'installed-book' });
        installedBook.getApps = async () => [new App({ id: 'stock-bot' })];
        await expect(requireAppInstallation(installedBook)).resolves.toBeUndefined();

        const missingBook = new Book({ id: 'missing-book' });
        missingBook.getApps = async () => [];
        try {
            await requireAppInstallation(missingBook);
            throw new Error('Expected installation authorization to fail');
        } catch (error: unknown) {
            expect(error).toBeInstanceOf(HTTPException);
            if (error instanceof HTTPException) {
                expect(error.status).toBe(403);
                expect(error.message).toContain('Portfolio Bot');
            }
        }
    });
});

function expectPermissionResult(action: () => void, allowed: boolean): void {
    if (allowed) {
        expect(action).not.toThrow();
    } else {
        expect(action).toThrow(HTTPException);
    }
}

function getHttpException(action: () => void): HTTPException {
    try {
        action();
    } catch (error: unknown) {
        if (error instanceof HTTPException) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected authorization to fail');
}
