/**
 * The report renderer: `<report-view>` and its events. Self-contained (no app state, no network),
 * so the web app and a standalone report file can bundle it alone.
 */
export { ReportView } from './report-view.js';
export { EXPAND_ROW, OPEN_IN_BKPER } from './events.js';
export type { ExpandRowDetail, OpenInBkperDetail } from './events.js';
export type { ReportSpec } from './spec-types.js';
