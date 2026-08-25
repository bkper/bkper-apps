import { describe, expect, it } from 'bun:test';
import {
    createInitialExportAppState,
    isExportAvailable,
    type ExportAppState,
} from '../src/export-app-state';

describe('export app startup state', () => {
    it('starts in a non-actionable authentication state', () => {
        const state = createInitialExportAppState();

        expect(state.authentication).toBe('pending');
        expect(isExportAvailable(state)).toBe(false);
    });

    it('allows export only after authentication and Book loading complete', () => {
        const readyState: ExportAppState = {
            authentication: 'authenticated',
            loading: false,
            exporting: false,
            bookId: 'book-123',
        };

        expect(isExportAvailable(readyState)).toBe(true);
        expect(isExportAvailable({ ...readyState, authentication: 'required' })).toBe(false);
        expect(isExportAvailable({ ...readyState, authentication: 'error' })).toBe(false);
        expect(isExportAvailable({ ...readyState, loading: true })).toBe(false);
        expect(isExportAvailable({ ...readyState, exporting: true })).toBe(false);
        expect(isExportAvailable({ ...readyState, bookId: null })).toBe(false);
    });
});
