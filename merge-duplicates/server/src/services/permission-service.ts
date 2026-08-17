import { Permission, type Book } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';

const WRITE_PERMISSIONS = new Set([Permission.OWNER, Permission.EDITOR, Permission.POSTER]);
const LEARNING_PERMISSIONS = new Set([Permission.OWNER, Permission.EDITOR]);

export function requireScanPermission(book: Book): void {
    requirePermission(book, WRITE_PERMISSIONS, 'OWNER, EDITOR, or POSTER to analyze duplicates');
}

export function requireMergePermission(book: Book): void {
    requirePermission(book, WRITE_PERMISSIONS, 'OWNER, EDITOR, or POSTER to merge transactions');
}

export function getLearningPermission(book: Book): 'write' | 'skip' {
    const permission = book.getPermission();
    if (LEARNING_PERMISSIONS.has(permission)) return 'write';
    if (permission === Permission.POSTER) return 'skip';
    throw new HTTPException(403, {
        message: `Learning requires OWNER or EDITOR permission. Current: ${permission ?? 'unavailable'}.`,
    });
}

function requirePermission(book: Book, allowed: ReadonlySet<Permission>, purpose: string): void {
    const permission = book.getPermission();
    if (allowed.has(permission)) return;
    throw new HTTPException(403, {
        message: `Book permission ${purpose}. Current: ${permission ?? 'unavailable'}.`,
    });
}
