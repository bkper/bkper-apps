/**
 * The BreakdownTable of a report: its rows by size, each with its amount, share, change and
 * months, and the total under them when the spec has one (the net result of Incoming and
 * Outgoing); rows with children open in place. A table with disclosure buttons, lighter than a
 * data grid and fully under the report's control (hover and focus highlight the chart).
 */
import { html, nothing, svg } from 'lit';
import { isolate } from 'report-shared/bidi';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { faded, typeColor } from './colors.js';
import { ReportFormat } from './format.js';
import type { BreakdownRow, PropsOf } from './spec-types.js';

type TableProps = PropsOf<'BreakdownTable'>;
type TableTotal = NonNullable<TableProps['total']>;

export interface BreakdownState {
    format: ReportFormat;
    /** Rows open in place. */
    expanded: ReadonlySet<string>;
    /** Rows open only when the spec binds the `expandRow` action. */
    expandable: boolean;
    /** The row the chart highlights. */
    highlighted?: string;
    /** Colors of the rows the chart draws, as their legend. */
    swatches: ReadonlyMap<string, string>;
    onToggle(rowId: string): void;
    onHover(rowId: string | undefined): void;
}

/** Months a row needs for a trend line. */
const MIN_TREND_MONTHS = 2;

const CHEVRON = svg`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderBreakdown(table: TableProps, state: BreakdownState) {
    if (table.rows.length === 0) {
        return html`<p class="breakdown-empty">${table.emptyLabel}</p>`;
    }
    const columns = {
        share: hasAny(table.rows, row => row.share !== undefined),
        change:
            table.total?.change !== undefined ||
            hasAny(table.rows, row => row.change !== undefined),
        trend: table.months.length >= MIN_TREND_MONTHS,
    };
    const row = (entry: BreakdownRow, depth: number): unknown => {
        const open = state.expanded.has(entry.id);
        const parent = state.expandable && entry.children.length > 0;
        const swatch = depth === 0 ? state.swatches.get(entry.id) : undefined;
        const label = html`
            ${
                swatch
                    ? html`<span
                          class="swatch"
                          style=${styleMap({ '--swatch-color': swatch })}
                      ></span>`
                    : nothing
            }
            <span class="row-label">${entry.label}</span>
        `;
        return html`
            <tr
                class=${classMap({
                    row: true,
                    child: depth > 0,
                    open,
                    highlighted: entry.id === state.highlighted,
                })}
                data-row=${entry.id}
                style=${styleMap({ '--depth': String(depth) })}
                @pointerenter=${() => state.onHover(entry.id)}
                @focusin=${() => state.onHover(entry.id)}
            >
                <th scope="row" class="name">
                    ${
                        parent
                            ? html`<button
                                  class="toggle"
                                  type="button"
                                  aria-expanded=${open ? 'true' : 'false'}
                                  title=${open ? table.collapseLabel : table.expandLabel}
                                  @click=${() => state.onToggle(entry.id)}
                              >
                                  <span class="chevron">${CHEVRON}</span>${label}
                              </button>`
                            : html`<span class="leaf">${label}</span>`
                    }
                </th>
                <td class="amount">${state.format.amount(entry.amount)}</td>
                ${
                    columns.share
                        ? html`<td class="ratio share">
                              ${entry.share === undefined ? nothing : state.format.share(entry.share)}
                          </td>`
                        : nothing
                }
                ${
                    columns.change
                        ? html`<td class="ratio change">
                              ${entry.change === undefined ? nothing : state.format.change(entry.change)}
                          </td>`
                        : nothing
                }
                ${columns.trend ? html`<td class="trend">${trend(entry, table)}</td>` : nothing}
            </tr>
            ${open && parent ? entry.children.map(child => row(child, depth + 1)) : nothing}
        `;
    };
    return html`
        <table class="breakdown">
            <caption class="visually-hidden">
                ${table.label}
            </caption>
            <thead>
                <tr>
                    <th scope="col" class="name">${table.columns.name}</th>
                    <th scope="col" class="amount">${table.columns.amount}</th>
                    ${
                        columns.share
                            ? html`<th scope="col" class="ratio share">${table.columns.share}</th>`
                            : nothing
                    }
                    ${
                        columns.change
                            ? html`<th scope="col" class="ratio change">
                                  ${table.columns.change}
                              </th>`
                            : nothing
                    }
                    ${
                        columns.trend
                            ? html`<th scope="col" class="trend">${table.columns.trend}</th>`
                            : nothing
                    }
                </tr>
            </thead>
            <tbody
                @pointerleave=${() => state.onHover(undefined)}
                @focusout=${() => state.onHover(undefined)}
            >
                ${table.rows.map(entry => row(entry, 0))}
            </tbody>
            ${table.total ? renderTotal(table.total, table, columns, state.format) : nothing}
        </table>
    `;
}

function renderTotal(
    total: TableTotal,
    table: TableProps,
    columns: { share: boolean; change: boolean; trend: boolean },
    format: ReportFormat
) {
    return html`<tfoot>
        <tr class="total">
            <th scope="row" class="name">
                <span class="leaf"><span class="row-label">${total.label}</span></span>
            </th>
            <td class="amount">${format.amount(total.amount)}</td>
            ${columns.share ? html`<td class="ratio share"></td>` : nothing}
            ${
                columns.change
                    ? html`<td class="ratio change">
                          ${total.change === undefined ? nothing : format.change(total.change)}
                      </td>`
                    : nothing
            }
            ${columns.trend ? html`<td class="trend">${trend(total, table)}</td>` : nothing}
        </tr>
    </tfoot>`;
}

function trend(row: BreakdownRow | TableTotal, table: TableProps) {
    const color = typeColor(row.color, 'high');
    return html`<wa-sparkline
        appearance="gradient"
        data=${row.months.map(ReportFormat.plot).join(' ')}
        label=${`${table.columns.trend}: ${isolate(row.label)}`}
        style=${styleMap({ '--line-color': color, '--fill-color': faded(color) })}
    ></wa-sparkline>`;
}

function hasAny(rows: BreakdownRow[], test: (row: BreakdownRow) => boolean): boolean {
    return rows.some(row => test(row) || hasAny(row.children, test));
}
