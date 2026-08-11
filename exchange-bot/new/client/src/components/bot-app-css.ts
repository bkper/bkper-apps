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

    .error {
        color: var(--bkper-color-danger);
    }

    .permission-error {
        margin-top: var(--bkper-spacing-large);
    }

    .warnings {
        margin-top: var(--bkper-spacing-large);
    }

    .warnings-title {
        display: flex;
        gap: var(--bkper-spacing-2x-small);
        align-items: center;
    }

    .warnings-title wa-icon {
        color: var(--bkper-color-warning);
        font-size: 18px;
    }

    .warnings-title span {
        font-size: 14px;
        font-weight: var(--bkper-font-weight-bold);
    }

    .warnings-list {
        display: grid;
        gap: var(--bkper-spacing-small);
        margin-top: var(--bkper-spacing-small);
    }

    .warning {
        padding-left: var(--bkper-spacing-small);
        border-left: 0.25rem solid var(--bkper-color-warning);
    }

    wa-spinner {
        font-size: 2rem;
        --track-width: 0.125em;
    }
`;
