import { Permission, type Book } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';

const VIEW_PERMISSIONS: readonly Permission[] = [
    Permission.VIEWER,
    Permission.POSTER,
    Permission.EDITOR,
    Permission.OWNER,
];

const EDIT_PERMISSIONS: readonly Permission[] = [Permission.EDITOR, Permission.OWNER];

export function requireViewPermission(book: Book): void {
    requirePermission(book, VIEW_PERMISSIONS);
}

export function requireEditPermission(book: Book): void {
    requirePermission(book, EDIT_PERMISSIONS);
}

function requirePermission(book: Book, allowedPermissions: readonly Permission[]): void {
    const permission = book.getPermission();
    if (!allowedPermissions.includes(permission)) {
        const required = formatPermissionList(allowedPermissions);
        const current = formatPermission(permission);
        throw new HTTPException(403, {
            message: `Required Book permission: ${required}. Current: ${current}.`,
        });
    }
}

function formatPermissionList(permissions: readonly Permission[]): string {
    const labels = permissions.map(formatPermission);
    if (labels.length === 1) {
        return labels[0];
    }
    if (labels.length === 2) {
        return `${labels[0]} or ${labels[1]}`;
    }
    return `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`;
}

function formatPermission(permission: Permission | undefined): string {
    return permission ?? 'unavailable';
}
