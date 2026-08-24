import { css } from 'lit';

export const botAppCSS = css`
    :host {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        min-height: 100dvh;
    }

    .body {
        display: flex;
        box-sizing: border-box;
        flex: 1;
        flex-direction: column;
        padding: var(--bkper-spacing-large);
    }

    .centered {
        display: grid;
        flex: 1;
        place-items: center;
    }

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

    .accounts-container {
        margin-top: var(--bkper-spacing-large);
    }

    .accounts-container h3 {
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

    wa-spinner {
        font-size: 2rem;
        --track-width: 0.125em;
    }
`;
