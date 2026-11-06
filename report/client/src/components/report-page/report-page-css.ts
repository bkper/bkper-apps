import { css } from 'lit';

export const reportPageCSS = css`
    :host {
        display: block;
        container-type: inline-size;
    }

    .page {
        display: grid;
        /* A wide report scrolls inside itself rather than widening the input. */
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wa-space-l);
        max-inline-size: calc(var(--wa-space-scale) * 56rem);
        margin-inline: auto;
    }

    .bar {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        min-inline-size: 0;
        margin-block-end: calc(-1 * var(--wa-space-s));
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
    }

    .back {
        margin-inline-start: calc(-1 * var(--wa-space-s));
    }

    .back::part(button) {
        color: var(--wa-color-text-quiet);
    }

    .book {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .book::before {
        content: '/';
        margin-inline-end: var(--wa-space-xs);
        opacity: 0.6;
    }

    .glyph {
        inline-size: 1.1em;
        block-size: 1.1em;
    }

    /* The request: one large input and a thin line under it while a report is on its way. */

    .ask {
        display: grid;
        gap: var(--wa-space-2xs);
    }

    .prompt {
        --wa-form-control-height: calc(var(--wa-space-scale) * 3.5rem);
    }

    .prompt::part(form-control-label) {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .prompt::part(input) {
        font-size: var(--wa-font-size-l);
    }

    .prompt .glyph {
        color: var(--wa-color-brand-on-quiet);
    }

    .progress {
        --track-height: var(--wa-border-width-m);
        --track-color: transparent;
        opacity: 0;
        transition: opacity var(--wa-transition-normal) var(--wa-transition-easing);
    }

    /* Visible only when the wait is felt: cached reports answer before the line appears. */
    .progress.active {
        opacity: 1;
        transition-delay: var(--wa-transition-normal);
    }

    .notice {
        margin: 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        line-height: var(--wa-line-height-normal);
    }

    .notice.alert {
        color: var(--wa-color-danger-on-quiet);
    }

    /* The report changes in place with a short view transition scoped to it (see follow). */
    .report {
        margin-block-start: var(--wa-space-s);
    }

    .report::view-transition-group(*) {
        animation-duration: var(--wa-transition-slow);
        animation-timing-function: var(--wa-transition-easing);
    }

    @media (prefers-reduced-motion: reduce) {
        .progress,
        .progress.active {
            transition: none;
        }
    }
`;
