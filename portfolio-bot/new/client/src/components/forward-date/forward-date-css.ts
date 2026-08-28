import { css } from 'lit';

export const forwardDateCSS = css`
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
