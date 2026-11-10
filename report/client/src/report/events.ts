/**
 * Events a report fires for its host. They bubble and cross shadow roots.
 *
 * - `report-open-in-bkper`: the person follows the link to the report's query in Bkper (the
 *   spec's `openInBkper` action) with a plain click. Cancel it to navigate another way;
 *   otherwise the link opens in a new tab, as it does for a click that asks for one.
 * - `report-expand-row`: a breakdown row opened or closed in place (the `expandRow` action).
 * - `report-select-chart`: the person chose one of the charts that fit, which the report now
 *   shows (the `selectChart` action). Hosts may keep it, such as in the report's state.
 */
import type { ViewKind } from './spec-types.js';

export interface OpenInBkperDetail {
    url: string;
}

export interface ExpandRowDetail {
    rowId: string;
    expanded: boolean;
}

export interface SelectChartDetail {
    kind: ViewKind;
}

export const OPEN_IN_BKPER = 'report-open-in-bkper';
export const EXPAND_ROW = 'report-expand-row';
export const SELECT_CHART = 'report-select-chart';

declare global {
    interface HTMLElementEventMap {
        [OPEN_IN_BKPER]: CustomEvent<OpenInBkperDetail>;
        [EXPAND_ROW]: CustomEvent<ExpandRowDetail>;
        [SELECT_CHART]: CustomEvent<SelectChartDetail>;
    }
}

export function reportEvent<T>(type: string, detail: T, cancelable = false): CustomEvent<T> {
    return new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable });
}
