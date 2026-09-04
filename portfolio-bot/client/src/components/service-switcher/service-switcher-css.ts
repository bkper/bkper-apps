import { css } from 'lit';

export const serviceSwitcherCSS = css`
    .heading {
        display: flex;
        align-items: center;
        gap: var(--bkper-spacing-x-small);
    }

    h2 {
        margin: 0;
        font-size: var(--bkper-font-size-large);
    }

    wa-dropdown-item.selected {
        cursor: default;
    }

    @media (hover: hover) {
        wa-dropdown-item.selected:hover {
            background-color: transparent;
        }
    }
`;
