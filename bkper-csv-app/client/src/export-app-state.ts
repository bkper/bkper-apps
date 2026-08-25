export type AuthenticationStatus = 'pending' | 'authenticated' | 'required' | 'error';

export interface ExportAppState {
    authentication: AuthenticationStatus;
    loading: boolean;
    exporting: boolean;
    bookId: string | null;
}

export function createInitialExportAppState(): ExportAppState {
    return {
        authentication: 'pending',
        loading: false,
        exporting: false,
        bookId: null,
    };
}

export function isExportAvailable(state: ExportAppState): boolean {
    return (
        state.authentication === 'authenticated' &&
        !state.loading &&
        !state.exporting &&
        state.bookId !== null
    );
}
