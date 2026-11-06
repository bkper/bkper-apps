/**
 * Types of the report spec, from the shared catalog. Type-only imports: the renderer never
 * ships the catalog's validation code.
 */
import type { BreakdownRow, ReportComponent, ReportElement } from 'report-shared/catalog';

export type { BreakdownRow, ReportElement, ReportSpec } from 'report-shared/catalog';

export type PropsOf<T extends ReportComponent> = Extract<ReportElement, { type: T }>['props'];

/** A Bkper type color: Asset blue, Liability yellow, Incoming green, Outgoing red, mixed grey. */
export type TypeColor = BreakdownRow['color'];

/** The row with an id, at any depth. */
export function findRow(rows: BreakdownRow[], id: string): BreakdownRow | undefined {
    for (const row of rows) {
        const found = row.id === id ? row : findRow(row.children, id);
        if (found) {
            return found;
        }
    }
    return undefined;
}

/** The top-level row that is, or contains, the row with an id. */
export function topRow(rows: BreakdownRow[], id: string): BreakdownRow | undefined {
    return rows.find(row => findRow([row], id));
}
