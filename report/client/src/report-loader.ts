let loading: Promise<void> | undefined;

/**
 * Loads `<report-view>` with its charts: most of the client's code, so the page shows and
 * takes input before it arrives. Loaded once, when the app opens; a failed load is retried on
 * the next call.
 */
export function loadReportRenderer(): Promise<void> {
    loading ??= import('./report/index.js').then(
        () => undefined,
        (error: unknown) => {
            loading = undefined;
            throw error;
        }
    );
    return loading;
}
