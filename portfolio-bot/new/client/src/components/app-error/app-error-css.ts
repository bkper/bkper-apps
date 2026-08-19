import { css } from 'lit';

export const appErrorCSS = css`
    .container h2 {
        margin: 0;
        font-size: var(--bkper-font-size-large);
    }

    .container p {
        margin: 0;
    }

    .container h2 + p {
        margin-top: var(--bkper-spacing-x-small);
    }

    .container.info p {
        color: var(--bkper-color-grey-high);
    }

    .container.error p {
        color: var(--bkper-color-danger);
    }

    .container a {
        color: var(--bkper-color-link);
        text-decoration: underline;
    }
`;
