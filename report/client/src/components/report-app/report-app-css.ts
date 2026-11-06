import { css } from 'lit';

export const reportAppCSS = css`
    /* The visible part of the page (see VisualViewportController): nothing outside it scrolls. */
    :host {
        position: fixed;
        inset-inline: 0;
        inset-block-start: var(--report-viewport-top, 0);
        display: block;
        block-size: var(--report-viewport-height, 100dvh);
        box-sizing: border-box;
        background: var(--bkper-color-background);
        color: var(--bkper-color-text);
        font-family: var(--bkper-font-family);
    }

    report-page {
        block-size: 100%;
    }

    .container {
        max-width: 720px;
        margin: 0 auto;
    }

    .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--bkper-spacing-small);
        min-height: 8rem;
        color: var(--bkper-color-neutral);
    }
`;
