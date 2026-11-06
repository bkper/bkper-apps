/** The Chart of a report, drawn by Web Awesome Pro's chart elements. */
import { html } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { ChartView } from './chart-config.js';

/** Height of one ranked bar, so ranked charts grow with their rows. */
const RANKED_ROW = 2.25;
const RANKED_AXIS = 2.5;

export function renderChart(view: ChartView, label: string, dir: 'ltr' | 'rtl') {
    const rows = view.config.data.labels?.length ?? 0;
    const size = view.horizontal
        ? styleMap({ '--chart-height': `${rows * RANKED_ROW + RANKED_AXIS}rem` })
        : styleMap({});
    const chart =
        view.element === 'doughnut'
            ? html`<wa-doughnut-chart
                  .config=${view.config}
                  label=${label}
                  dir=${dir}
                  without-legend
              ></wa-doughnut-chart>`
            : view.element === 'line'
              ? html`<wa-line-chart
                    .config=${view.config}
                    label=${label}
                    dir=${dir}
                    grid="y"
                    ?without-legend=${!view.legend}
                ></wa-line-chart>`
              : html`<wa-bar-chart
                    .config=${view.config}
                    label=${label}
                    dir=${dir}
                    orientation=${view.horizontal ? 'horizontal' : 'vertical'}
                    grid=${view.horizontal ? 'x' : 'y'}
                    ?without-legend=${!view.legend}
                ></wa-bar-chart>`;
    return html`<figure class="chart ${view.horizontal ? 'ranked' : view.element}" style=${size}>
        ${chart}
    </figure>`;
}
