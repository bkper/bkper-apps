import { css } from 'lit';

export const reportAppCSS = css`
    :host {
        display: block;
        min-height: 100vh;
        box-sizing: border-box;
        padding: var(--bkper-spacing-large);
        background: var(--bkper-color-background);
        color: var(--bkper-color-text);
        font-family: var(--bkper-font-family);
    }

    .container {
        max-width: 720px;
        margin: 0 auto;
    }

    .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--bkper-spacing-small);
        min-height: 8rem;
        color: var(--bkper-color-neutral);
    }
`;
