import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import {
    getLearningPermission,
    requireMergePermission,
    requireScanPermission,
} from '../src/services/permission-service';

function book(permission: Permission): Book {
    return new Book({ id: 'book', permission });
}

describe('workflow permissions', () => {
    it('stops viewers before scan and allows posters to scan and merge', () => {
        expect(() => requireScanPermission(book(Permission.VIEWER))).toThrow();
        expect(() => requireScanPermission(book(Permission.POSTER))).not.toThrow();
        expect(() => requireMergePermission(book(Permission.POSTER))).not.toThrow();
    });

    it('allows learning only for owner/editor and explicitly skips posters', () => {
        expect(getLearningPermission(book(Permission.OWNER))).toBe('write');
        expect(getLearningPermission(book(Permission.EDITOR))).toBe('write');
        expect(getLearningPermission(book(Permission.POSTER))).toBe('skip');
        expect(() => getLearningPermission(book(Permission.VIEWER))).toThrow();
    });
});
