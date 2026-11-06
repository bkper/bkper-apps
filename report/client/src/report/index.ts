/**
 * The report renderer: `<report-view>` and its events. Self-contained (no app state, no network),
 * so the web app and a standalone report file can bundle it alone.
 */
export { ReportView } from './report-view.js';
export { EXPAND_ROW, OPEN_IN_BKPER, SELECT_CHART } from './events.js';
export type { ExpandRowDetail, OpenInBkperDetail, SelectChartDetail } from './events.js';
export type { ReportLink, ReportSpec, ViewKind } from './spec-types.js';
