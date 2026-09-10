import { css } from 'lit';

export const accountListCSS = css`
    :host {
        display: block;
        margin-top: var(--bkper-spacing-large);
    }

    h3 {
        margin: 0;
        font-size: var(--bkper-font-size-medium);
    }

    .accounts {
        margin-top: var(--bkper-spacing-small);
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--bkper-spacing-x-small);
    }

    .account {
        display: flex;
        flex-wrap: wrap;
        gap: var(--bkper-spacing-small);
        align-items: center;
    }

    .account-result {
        display: inline-flex;
        min-width: 0;
        gap: var(--bkper-spacing-2x-small);
        align-items: center;
    }

    .account-result wa-spinner {
        font-size: var(--bkper-font-size-medium);
        --track-width: 0.125em;
    }

    .account-result wa-icon {
        flex-shrink: 0;
        font-size: 18px;
    }

    .account-result.complete wa-icon {
        color: var(--bkper-color-success);
    }

    .account-result.error wa-icon,
    .account-result.error {
        color: var(--bkper-color-danger);
    }

    .account-type {
        display: inline-block;
        width: var(--bkper-spacing-x-small);
        height: var(--bkper-spacing-x-small);
        flex-shrink: 0;
        border-radius: 50%;
    }

    .account-type.asset {
        background-color: var(--bkper-color-blue-medium);
    }

    .account-type.liability {
        background-color: var(--bkper-color-yellow-medium);
    }

    .account-type.incoming {
        background-color: var(--bkper-color-green-medium);
    }

    .account-type.outgoing {
        background-color: var(--bkper-color-red-medium);
    }
`;
