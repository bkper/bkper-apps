import { css } from 'lit';

export const appHeaderCSS = css`
    :host {
        display: block;
    }

    .container {
        --branding-width: 11rem;
        box-sizing: border-box;
        position: relative;
        display: grid;
        grid-template-columns: var(--branding-width) minmax(0, 1fr) var(--branding-width);
        align-items: center;
        gap: var(--bkper-spacing-small);
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
        font-size: var(--bkper-font-size-medium);
    }

    .book-name {
        min-width: 0;
        margin: 0;
        overflow: hidden;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--bkper-font-size-small);
    }

    @media (max-width: 767px) {
        .container {
            --branding-width: 50px;
        }
    }
`;
