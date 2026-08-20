import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import {
    requireAnalyzePermission,
    requireLearningPermission,
    requireMergePermission,
} from '../src/services/permission-service';

function book(permission: Permission): Book {
    return new Book({ id: 'book', permission });
}

describe('workflow permissions', () => {
    it('stops viewers before analysis and allows posters to analyze and merge', () => {
        expect(() => requireAnalyzePermission(book(Permission.VIEWER))).toThrow();
        expect(() => requireAnalyzePermission(book(Permission.POSTER))).not.toThrow();
        expect(() => requireMergePermission(book(Permission.POSTER))).not.toThrow();
    });

    it('allows learning only for owner/editor and rejects posters', () => {
        expect(() => requireLearningPermission(book(Permission.OWNER))).not.toThrow();
        expect(() => requireLearningPermission(book(Permission.EDITOR))).not.toThrow();
        expect(() => requireLearningPermission(book(Permission.POSTER))).toThrow();
        expect(() => requireLearningPermission(book(Permission.VIEWER))).toThrow();
    });
});
