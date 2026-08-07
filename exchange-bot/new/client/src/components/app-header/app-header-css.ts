import { css } from 'lit';

export const appHeaderCSS = css`
    :host {
        display: block;
    }

    .container {
        box-sizing: border-box;
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
        height: 64px;
        padding: 0 var(--bkper-spacing-small);
        border-bottom: var(--bkper-border);
    }

    .app {
        display: flex;
        align-items: center;
        gap: var(--bkper-spacing-small);
    }

    .app-logo {
        display: block;
        width: 50px;
        height: 50px;
    }

    .app-title {
        margin: 0;
        line-height: 1.2;
        font-size: var(--bkper-font-size-large);
    }

    .book-name {
        position: absolute;
        left: 50%;
        margin: 0;
        transform: translateX(-50%);
        font-size: var(--bkper-font-size-medium);
    }
`;
