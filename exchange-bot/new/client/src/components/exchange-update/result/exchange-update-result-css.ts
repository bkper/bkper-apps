import { css } from 'lit';

export const exchangeUpdateResultCSS = css`
    .container {
        display: flex;
        height: 38px;
        gap: var(--bkper-spacing-x-small);
        align-items: center;
    }

    .container wa-icon {
        font-size: 18px;
        color: var(--bkper-color-success);
    }

    .trigger {
        padding: 0;
        border: 0;
        background: none;
        color: var(--bkper-color-link);
        cursor: pointer;
        font: inherit;
        text-decoration: underline;
    }

    .popover::part(body) {
        padding: var(--bkper-spacing-medium);
        padding-left: 20px;
        padding-right: var(--bkper-spacing-x-small);
        width: min(24rem, calc(100vw - 5rem));
    }

    .content {
        max-height: min(60vh, 30rem);
        overflow-y: auto;
        overscroll-behavior: contain;
    }

    .empty-result {
        margin: 0;
        color: var(--bkper-color-grey-high);
        font-size: var(--bkper-font-size-small);
    }

    .result-list {
        margin: 0;
        font-family: var(--bkper-font-family-code);
        font-size: var(--bkper-font-size-small);
    }

    .result-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--bkper-spacing-medium);
        padding: var(--bkper-spacing-x-small) 0;
        border-bottom: var(--bkper-border);
    }

    .result-row:first-child {
        padding-top: 0;
    }

    .result-row:last-child {
        padding-bottom: 0;
        border-bottom: 0;
    }

    .result-row dt {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .result-row dd {
        margin: 0;
        margin-right: 20px;
        text-align: right;
        white-space: nowrap;
    }

    @media (max-width: 360px) {
        .popover::part(body) {
            box-sizing: border-box;
            width: calc(100vw - var(--bkper-spacing-small));
        }
    }
`;
