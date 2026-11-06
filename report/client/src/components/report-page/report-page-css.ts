import { css } from 'lit';

export const reportPageCSS = css`
    :host {
        display: block;
        container-type: inline-size;
    }

    /* The report scrolls; the dock under it never moves, and grows upwards. */
    .page {
        display: flex;
        flex-direction: column;
        block-size: 100%;
    }

    .scroll {
        flex: 1 1 auto;
        min-block-size: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
    }

    .content {
        display: grid;
        /* A wide report scrolls inside itself rather than widening the page. */
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wa-space-l);
        box-sizing: border-box;
        max-inline-size: calc(var(--wa-space-scale) * 56rem);
        margin-inline: auto;
        padding: var(--bkper-spacing-large);
    }

    .dock {
        flex: none;
        display: grid;
        gap: var(--bkper-spacing-x-small);
    }

    .dock > :not(.bar) {
        margin-inline: var(--bkper-spacing-small);
    }

    .dock > :first-child:not(.bar) {
        margin-block-start: var(--bkper-spacing-x-small);
    }

    /*
     * The Book's transaction input, measure for measure: a pill field in a bar 3.75rem high
     * (padding medium above, small at the sides) at the top of a footer 5.1875rem high, with
     * the Book's border instead of the form control's.
     */
    /* Its padding above the input is the space under what sits over it. */
    .bar {
        margin-block-start: calc(-1 * var(--bkper-spacing-x-small));
        position: relative;
        box-sizing: border-box;
        min-block-size: calc(var(--wa-space-scale) * 5.1875rem);
        padding: var(--bkper-spacing-medium) var(--bkper-spacing-small) 0;
        background-color: var(--bkper-background-color);
    }

    .prompt {
        display: block;
        padding-block-start: var(--bkper-spacing-2x-small);
    }

    .prompt::part(input-wrapper) {
        border: var(--bkper-border);
    }

    .prompt::part(form-control-label) {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    /* Where the transaction input has its attachment icons. */
    .glyph {
        inline-size: 1em;
        block-size: 1em;
        font-size: var(--bkper-font-size-large);
        color: var(--wa-color-neutral-on-quiet);
    }

    /* A thin line under the input, inside the pill's straight edge, while a report is on its way. */
    .progress {
        --track-height: var(--wa-border-width-m);
        --track-color: transparent;
        margin-block-start: var(--bkper-spacing-2x-small);
        margin-inline: var(--bkper-spacing-large);
        opacity: 0;
        transition: opacity var(--wa-transition-normal) var(--wa-transition-easing);
    }

    /* Visible only when the wait is felt: cached reports answer before the line appears. */
    .progress.active {
        opacity: 1;
        transition-delay: var(--wa-transition-normal);
    }

    .notice {
        margin-block: 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        line-height: var(--wa-line-height-normal);
    }

    .notice.alert {
        color: var(--wa-color-danger-on-quiet);
    }

    /* The report changes in place with a short view transition scoped to it (see follow). */
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
