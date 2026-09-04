import { css } from 'lit';

export const costOfGoodsSoldCSS = css`
    .intro h2 {
        margin: 0;
        font-size: var(--bkper-font-size-large);
    }

    .intro p {
        margin: 0;
        margin-top: var(--bkper-spacing-x-small);
        color: var(--bkper-color-grey-high);
    }

    .intro p span {
        font-weight: var(--bkper-font-weight-bold);
    }

    .date-input,
    .actions {
        margin-top: var(--bkper-spacing-large);
    }

    .date-input {
        width: min(100%, 16rem);
    }

    .actions {
        display: flex;
        flex-direction: column;
        gap: var(--bkper-spacing-x-small);
        align-items: flex-start;
    }

    .action-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--bkper-spacing-x-small);
    }
`;
