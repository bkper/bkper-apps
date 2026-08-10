import { css } from 'lit';

export const exchangeUpdateCSS = css`
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
    .rates,
    .rates-error {
        margin-top: var(--bkper-spacing-large);
    }

    .date-input,
    .rate-input {
        width: min(100%, 20rem);
    }

    .rates,
    .rates-error {
        width: 100%;
    }

    .rates {
        display: flex;
        flex-direction: column;
        gap: var(--bkper-spacing-small);
    }

    .rate {
        display: flex;
        flex-wrap: wrap;
        gap: var(--bkper-spacing-small);
        align-items: end;
    }

    .update-result {
        display: flex;
        height: 38px;
        gap: var(--bkper-spacing-x-small);
        align-items: center;
    }

    .update-result.waiting wa-spinner {
        font-size: 1.25rem;
        --track-width: 0.125em;
    }

    .update-result.complete wa-icon {
        font-size: 16px;
        color: var(--bkper-color-success);
    }

    .actions {
        display: flex;
        justify-content: flex-start;
        margin-top: var(--bkper-spacing-large);
    }

    .rates-loading {
        margin-top: var(--bkper-spacing-large);
        display: flex;
        gap: var(--bkper-spacing-x-small);
        align-items: center;
    }

    .error {
        color: var(--bkper-color-danger);
    }

    .rates-loading wa-spinner {
        font-size: 1.5rem;
        --track-width: 0.125em;
    }
`;
