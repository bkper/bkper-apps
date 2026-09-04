import { css } from 'lit';

export const sharedCSS = css`
    a,
    a:visited {
        color: var(--bkper-color-text);
        text-decoration: none;
    }

    .body a:hover {
        text-decoration: underline;
    }

    pre,
    code {
        font-family: var(--bkper-font-family-code);
    }

    .intro p {
        margin: 0;
        margin-top: var(--bkper-spacing-x-small);
        color: var(--bkper-color-grey-high);
    }

    .intro p span {
        font-weight: var(--bkper-font-weight-bold);
    }

    wa-dropdown-item > wa-icon {
        font-size: 16px;
    }

    wa-button[size='xs'] wa-icon {
        font-size: 16px;
    }

    wa-button:is([size='s'], [size='small']) wa-icon {
        font-size: 18px;
    }

    wa-button:is([size='m'], [size='medium']) wa-icon {
        font-size: 20px;
    }

    wa-button:is([size='l'], [size='large']) wa-icon {
        font-size: 22px;
    }

    wa-button[size='xl'] wa-icon {
        font-size: 24px;
    }

    wa-divider {
        padding: 0;
    }

    .focusable:focus-visible {
        border-radius: var(--bkper-border-radius);
        outline: var(--wa-focus-ring);
        outline-offset: var(--wa-focus-ring-offset);
        z-index: 1;
    }

    @media screen and (max-width: 767px) {
        .hide-on-phone {
            display: none !important;
        }
    }
`;
