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

    wa-spinner {
        font-size: 2rem;
        --track-width: 0.125em;
    }
`;
