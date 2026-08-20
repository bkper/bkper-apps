import type { SkippedCounts } from '../api/app-api';
import type { CapturedMenuContext } from './menu-context';
import type { ReviewPermission } from './review-session';

export interface AppState {
    context: CapturedMenuContext;
    authenticating: boolean;
    analyzing: boolean;
    applying: boolean;
    confirmOpen: boolean;
    contextUpdateAvailable: boolean;
    error: string | null;
    notice: string | null;
    scanned: number;
    permission: ReviewPermission | null;
    pages: number;
    skipped: SkippedCounts;
}

export function createInitialAppState(): AppState {
    return {
        context: { bookId: null, query: '', accountId: null, groupId: null },
        authenticating: true,
        analyzing: false,
        applying: false,
        confirmOpen: false,
        contextUpdateAvailable: false,
        error: null,
        notice: null,
        scanned: 0,
        permission: null,
        pages: 0,
        skipped: { total: 0, checked: 0, trashed: 0, locked: 0, invalid: 0 },
    };
}
