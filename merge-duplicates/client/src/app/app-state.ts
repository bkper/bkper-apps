import type { SkippedCounts } from '../api/app-api';
import type { CapturedMenuContext } from './menu-context';

export interface AppState {
    context: CapturedMenuContext;
    authenticating: boolean;
    analyzing: boolean;
    applying: boolean;
    confirmOpen: boolean;
    error: string | null;
    notice: string | null;
    scanned: number;
    candidateCount: number;
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
        error: null,
        notice: null,
        scanned: 0,
        candidateCount: 0,
        pages: 0,
        skipped: { total: 0, checked: 0, trashed: 0, locked: 0 },
    };
}
