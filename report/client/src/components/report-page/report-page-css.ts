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

    /*
     * The names completing the word typed: a list over the report, above the dock, so the input
     * and what sits on it stay in view. The measures of the Book's input suggestions (those of a
     * Web Awesome dropdown), aligned with the input, as wide as a name needs on wide pages.
     */
    .listbox {
        box-sizing: border-box;
        inline-size: min(
            calc(var(--wa-space-scale) * 28rem),
            calc(100cqi - 2 * var(--bkper-spacing-small))
        );
        max-block-size: var(--auto-size-available-height, none);
        margin-inline: var(--bkper-spacing-small);
        padding: var(--wa-space-2xs);
        overflow-y: auto;
        border: var(--wa-border-style) var(--wa-border-width-s) var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background-color: var(--wa-color-surface-raised);
        box-shadow: var(--wa-shadow-m);
        font-size: var(--bkper-font-size-medium);
    }

    /* As tall as the input, so a finger hits one name. */
    .option {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        min-block-size: var(--wa-form-control-height);
        padding-inline: var(--wa-space-m);
        border-radius: var(--wa-border-radius-s);
        color: var(--wa-color-text-normal);
        line-height: var(--wa-line-height-condensed);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }

    .option:hover {
        background-color: var(--wa-color-neutral-fill-quiet);
    }

    .option.active {
        background-color: var(--wa-color-neutral-fill-normal);
    }

    .name {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .kind {
        flex: none;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
    }

    /* The report changes in place with a short view transition scoped to it (see follow). */
    .report::view-transition-group(*) {
        animation-duration: var(--wa-transition-slow);
        animation-timing-function: var(--wa-transition-easing);
    }

    /*
     * Browsers stretch each snapshot to the transition's box by default, so while the report's
     * height changes (and while the next one is prepared) the last report showed scaled up.
     * Each snapshot keeps its own size, from the top.
     */
    .report::view-transition-old(*),
    .report::view-transition-new(*) {
        object-fit: none;
        object-position: top;
    }

    @media (prefers-reduced-motion: reduce) {
        .progress,
        .progress.active {
            transition: none;
        }
    }
`;
