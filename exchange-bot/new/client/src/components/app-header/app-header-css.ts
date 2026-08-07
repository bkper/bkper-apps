import { css } from 'lit';

export const appHeaderCSS = css`
    :host {
        display: block;
    }

    .title {
        margin: 0;
    }

    .subtitle {
        margin: 0;
        margin-top: var(--bkper-spacing-small);
        color: var(--bkper-color-neutral);
    }
`;
