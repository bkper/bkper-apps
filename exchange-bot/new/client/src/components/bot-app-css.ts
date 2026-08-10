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

    .permission-error {
        margin-top: var(--bkper-spacing-large);
    }

    .error {
        color: var(--bkper-color-danger);
    }

    wa-spinner {
        font-size: 2rem;
        --track-width: 0.125em;
    }
`;
