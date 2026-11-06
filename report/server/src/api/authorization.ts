import { Permission } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';

const VIEW_PERMISSIONS: readonly Permission[] = [
    Permission.VIEWER,
    Permission.POSTER,
    Permission.EDITOR,
    Permission.OWNER,
];

/** Requires a Book permission that can read balances. */
export function requireViewPermission(permission: string | undefined): void {
    if (!VIEW_PERMISSIONS.some(allowed => allowed === permission)) {
        throw new HTTPException(403, {
            message: `Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: ${permission ?? 'unavailable'}.`,
        });
    }
}
