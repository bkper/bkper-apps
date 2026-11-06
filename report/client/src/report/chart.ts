/** The Chart of a report, drawn by Web Awesome Pro's chart elements. */
import { html } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { ChartView } from './chart-config.js';

/** Height of one row of horizontal bars, so these charts grow with their rows. */
const RANKED_ROW = 2.25;
/** Height of a row of two bars side by side, such as a part now and before. */
const PAIRED_ROW = 3.25;
const RANKED_AXIS = 2.5;
const LEGEND = 2;

export function renderChart(view: ChartView, kind: string, label: string, dir: 'ltr' | 'rtl') {
    const rows = view.config.data.labels?.length ?? 0;
    const row = view.config.data.datasets.length > 1 ? PAIRED_ROW : RANKED_ROW;
    const size = view.horizontal
        ? styleMap({
              '--chart-height': `${rows * row + RANKED_AXIS + (view.legend ? LEGEND : 0)}rem`,
          })
        : styleMap({});
    const chart =
        view.element === 'doughnut'
            ? html`<wa-doughnut-chart
                  .config=${view.config}
                  label=${label}
                  dir=${dir}
                  without-legend
              ></wa-doughnut-chart>`
            : view.element === 'pie'
              ? html`<wa-pie-chart
                    .config=${view.config}
                    label=${label}
                    dir=${dir}
                    without-legend
                ></wa-pie-chart>`
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
    return html`<figure
        class="chart ${view.horizontal ? 'ranked' : view.element}"
        data-kind=${kind}
        style=${size}
    >
        ${chart}
    </figure>`;
}
