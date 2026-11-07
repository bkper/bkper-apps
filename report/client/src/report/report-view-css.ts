import { css } from 'lit';

export const reportViewCSS = css`
    :host {
        display: block;
        container-type: inline-size;
        color: var(--wa-color-text-normal);
        font-family: var(--wa-font-family-body);
        line-height: var(--wa-line-height-normal);
    }

    h1,
    h2,
    p,
    dl,
    dd,
    figure,
    ul {
        margin: 0;
        padding: 0;
    }

    .report {
        display: grid;
        gap: var(--wa-space-xl);
    }

    .visually-hidden {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    /* Header and answer: the amount asked for comes first. */

    .report-header h1 {
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-semibold);
        line-height: var(--wa-line-height-condensed);
    }

    .subtitle {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
    }

    .report-header + .answer {
        margin-block-start: calc(-1 * var(--wa-space-m));
    }

    .answer {
        display: grid;
        gap: var(--wa-space-2xs);
    }

    .answer-label {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
    }

    .answer-amount {
        font-size: var(--wa-font-size-3xl);
        font-weight: var(--wa-font-weight-semibold);
        line-height: var(--wa-line-height-condensed);
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
    }

    .answer-comparison {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wa-space-xs);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
    }

    /* Texts and numbers of several directions stay apart, such as dates within RTL text. */
    .answer-comparison > *,
    .answer-part > *,
    .source-facts dd,
    .source-footer > * {
        unicode-bidi: isolate;
    }

    .change {
        color: var(--wa-color-text-normal);
        font-weight: var(--wa-font-weight-semibold);
        font-variant-numeric: tabular-nums;
    }

    .previous {
        font-variant-numeric: tabular-nums;
    }

    .answer-parts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-xs) var(--wa-space-xl);
        margin-block-start: var(--wa-space-s);
        list-style: none;
        font-size: var(--wa-font-size-s);
    }

    .answer-part {
        display: flex;
        align-items: baseline;
        gap: var(--wa-space-xs);
    }

    .part-label {
        color: var(--wa-color-text-quiet);
    }

    .part-amount {
        font-weight: var(--wa-font-weight-semibold);
        font-variant-numeric: tabular-nums;
    }

    .answer-part .change {
        color: var(--wa-color-text-quiet);
        font-weight: var(--wa-font-weight-normal);
    }

    .swatch {
        display: inline-block;
        flex: none;
        inline-size: 0.625em;
        block-size: 0.625em;
        border-radius: var(--wa-border-radius-circle);
        background: var(--swatch-color);
    }

    /* Chart */

    .chart {
        --chart-height: 16rem;
        min-inline-size: 0;
    }

    .chart.doughnut,
    .chart.pie {
        --chart-height: 13rem;
    }

    .chart > * {
        aspect-ratio: auto;
        block-size: var(--chart-height);
    }

    /* Previews of every chart that fits: quiet cards that scroll sideways; the one shown stands out. */

    .previews {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-3xs);
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
    }

    .previews + .chart {
        margin-block-start: calc(-1 * var(--wa-space-m));
    }

    .preview {
        appearance: none;
        flex: none;
        display: grid;
        justify-items: center;
        align-content: start;
        gap: var(--wa-space-2xs);
        inline-size: 4.75rem;
        margin: 0;
        padding: var(--wa-space-xs) var(--wa-space-2xs);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-quiet);
        font: inherit;
        font-size: var(--wa-font-size-2xs);
        line-height: var(--wa-line-height-condensed);
        text-align: center;
        cursor: pointer;
    }

    .preview:not(.unfit):hover {
        border-color: var(--wa-color-neutral-border-normal);
        color: var(--wa-color-text-normal);
    }

    .preview[aria-pressed='true'] {
        border-color: var(--wa-color-brand-border-loud);
        box-shadow: inset 0 0 0 var(--wa-border-width-s) var(--wa-color-brand-border-loud);
        background: var(--wa-color-brand-fill-quiet);
        color: var(--wa-color-text-normal);
        cursor: default;
    }

    .preview:focus-visible {
        outline: var(--wa-focus-ring);
        outline-offset: var(--wa-focus-ring-offset);
    }

    /* The chart asked for that does not fit: dimmed, with why. */
    .preview.unfit {
        inline-size: auto;
        max-inline-size: 11rem;
        border-style: dashed;
        background: none;
        cursor: default;
    }

    .preview.unfit .thumb,
    .preview.unfit .preview-name {
        opacity: 0.45;
    }

    .thumb {
        display: block;
        inline-size: 3.75rem;
        aspect-ratio: 8 / 5;
    }

    .thumb svg {
        display: block;
        inline-size: 100%;
        block-size: 100%;
    }

    /* Like the chart below them, they run from the inline start. */
    .report[dir='rtl'] .thumb svg {
        transform: scaleX(-1);
    }

    .preview-name {
        font-weight: var(--wa-font-weight-semibold);
    }

    .preview-reason {
        overflow-wrap: break-word;
    }

    @container (max-width: 40rem) {
        .previews {
            flex-wrap: nowrap;
        }
    }

    /* Breakdown table */

    .breakdown {
        inline-size: 100%;
        border-collapse: collapse;
        font-size: var(--wa-font-size-s);
    }

    .breakdown th,
    .breakdown td {
        padding: var(--wa-space-xs) var(--wa-space-s);
        border-block-end: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        text-align: start;
        font-weight: var(--wa-font-weight-normal);
        vertical-align: middle;
    }

    .breakdown th:first-child,
    .breakdown td:first-child {
        padding-inline-start: 0;
    }

    .breakdown th:last-child,
    .breakdown td:last-child {
        padding-inline-end: 0;
    }

    .breakdown thead th {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-xs);
        white-space: nowrap;
    }

    .breakdown .amount,
    .breakdown .ratio {
        text-align: end;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .breakdown td.amount {
        font-weight: var(--wa-font-weight-semibold);
    }

    .breakdown td.ratio {
        color: var(--wa-color-text-quiet);
    }

    .row {
        transition: background-color var(--wa-transition-fast) var(--wa-transition-easing);
    }

    tbody .row:last-child > * {
        border-block-end: 0;
    }

    .breakdown tfoot th,
    .breakdown tfoot td {
        border-block-start: var(--wa-border-width-m) solid var(--wa-color-surface-border);
        border-block-end: 0;
        font-weight: var(--wa-font-weight-semibold);
    }

    .row.highlighted {
        background: var(--wa-color-neutral-fill-quiet);
    }

    .row.child td.amount {
        font-weight: var(--wa-font-weight-normal);
    }

    .name {
        inline-size: 100%;
    }

    .breakdown tbody .name {
        padding-inline-start: calc(var(--depth) * var(--wa-space-xl));
    }

    .toggle,
    .leaf {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        max-inline-size: 100%;
    }

    .toggle {
        appearance: none;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: var(--wa-border-radius-s);
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .toggle:focus-visible {
        outline: var(--wa-focus-ring);
        outline-offset: var(--wa-focus-ring-offset);
    }

    .leaf {
        padding-inline-start: calc(1em + var(--wa-space-xs));
    }

    .chevron {
        display: inline-flex;
        flex: none;
        inline-size: 1em;
        block-size: 1em;
        color: var(--wa-color-text-quiet);
        transition: transform var(--wa-transition-fast) var(--wa-transition-easing);
    }

    .chevron svg {
        inline-size: 100%;
        block-size: 100%;
    }

    .report[dir='rtl'] .chevron {
        transform: scaleX(-1);
    }

    .open > .name .chevron {
        transform: rotate(90deg);
    }

    .row-label {
        overflow-wrap: break-word;
    }

    .trend {
        text-align: end;
    }

    .trend wa-sparkline {
        display: inline-block;
        inline-size: 5rem;
        block-size: 1.25rem;
        vertical-align: middle;
    }

    .breakdown-empty {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
    }

    @container (max-width: 36rem) {
        .breakdown .trend {
            display: none;
        }
    }

    @container (max-width: 26rem) {
        .breakdown .share {
            display: none;
        }
    }

    /* Source */

    .source {
        display: grid;
        gap: var(--wa-space-s);
        padding-block-start: var(--wa-space-l);
        border-block-start: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-xs);
    }

    .source-title {
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
    }

    .source-facts {
        display: grid;
        gap: var(--wa-space-2xs);
    }

    .source-facts div {
        display: grid;
        grid-template-columns: minmax(7rem, max-content) 1fr;
        gap: var(--wa-space-s);
    }

    .source-facts dd {
        color: var(--wa-color-text-normal);
        min-inline-size: 0;
    }

    .source-calculated dt {
        color: var(--wa-color-text-normal);
        font-weight: var(--wa-font-weight-semibold);
    }

    code {
        font-family: var(--wa-font-family-code);
        overflow-wrap: anywhere;
    }

    .source-footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--wa-space-s);
    }

    .source-footer a {
        color: var(--wa-color-text-link);
        text-decoration: none;
        font-weight: var(--wa-font-weight-semibold);
    }

    .source-footer a:hover {
        text-decoration: underline;
    }

    .source-footer a:focus-visible {
        outline: var(--wa-focus-ring);
        outline-offset: var(--wa-focus-ring-offset);
        border-radius: var(--wa-border-radius-s);
    }
`;
