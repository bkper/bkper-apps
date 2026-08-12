import { css } from 'lit';

export const appErrorCSS = css`
    .access-required {
        max-width: 32rem;
    }

    .access-required h2 {
        margin: 0;
        font-size: var(--bkper-font-size-large);
    }

    .access-required p {
        margin: 0;
        margin-top: var(--bkper-spacing-x-small);
        color: var(--bkper-color-grey-high);
    }

    .access-required a {
        color: var(--bkper-color-link);
        text-decoration: underline;
    }

    .error {
        color: var(--bkper-color-danger);
    }
`;
