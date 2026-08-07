import { css } from 'lit';

export const exchangeUpdateCSS = css`
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
