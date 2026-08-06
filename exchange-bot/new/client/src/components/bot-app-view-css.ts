import { css } from 'lit';

export const botAppViewCSS = css`
    :host {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        min-height: 100dvh;
        padding: var(--bkper-spacing-large);
    }

    .app-title {
        margin: 0;
    }

    .app-subtitle {
        margin: 0;
        margin-top: var(--bkper-spacing-small);
        color: var(--bkper-color-neutral);
    }

    .body {
        display: flex;
        flex: 1;
        flex-direction: column;
        margin-top: var(--bkper-spacing-large);
        padding: var(--bkper-spacing-small);
    }

    .centered {
        display: grid;
        flex: 1;
        place-items: center;
    }

    .book-name {
        text-align: center;
    }

    .error {
        color: var(--bkper-color-danger);
    }

    wa-spinner {
        font-size: 2rem;
        --track-width: 0.125em;
    }
`;
