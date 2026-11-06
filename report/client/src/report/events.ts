/**
 * Events a report fires for its host. They bubble and cross shadow roots.
 *
 * - `report-open-in-bkper`: the person follows the link to the report's query in Bkper (the
 *   spec's `openInBkper` action). Cancel it to navigate another way; otherwise the link opens.
 * - `report-expand-row`: a breakdown row opened or closed in place (the `expandRow` action).
 */

export interface OpenInBkperDetail {
    url: string;
}

export interface ExpandRowDetail {
    rowId: string;
    expanded: boolean;
}

export const OPEN_IN_BKPER = 'report-open-in-bkper';
export const EXPAND_ROW = 'report-expand-row';

declare global {
    interface HTMLElementEventMap {
        [OPEN_IN_BKPER]: CustomEvent<OpenInBkperDetail>;
        [EXPAND_ROW]: CustomEvent<ExpandRowDetail>;
    }
}

export function reportEvent<T>(type: string, detail: T, cancelable = false): CustomEvent<T> {
    return new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable });
}
