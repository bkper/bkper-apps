import { css } from 'lit';

export const appErrorCSS = css`
    .container h2 {
        margin: 0;
        font-size: var(--bkper-font-size-large);
    }

    .container p {
        margin: 0;
        margin-top: var(--bkper-spacing-x-small);
        color: var(--bkper-color-grey-high);
    }

    .container a {
        color: var(--bkper-color-link);
        text-decoration: underline;
    }
`;
