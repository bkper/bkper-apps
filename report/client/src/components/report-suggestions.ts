import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Suggestion } from '../api/app-api';

/** The event a chosen suggestion fires, bubbling to the page. */
export const CHOOSE_SUGGESTION = 'report-choose-suggestion';

declare global {
    interface HTMLElementEventMap {
        [CHOOSE_SUGGESTION]: CustomEvent<Suggestion>;
    }
    interface HTMLElementTagNameMap {
        'report-suggestions': ReportSuggestions;
    }
}

/** Placeholders while the suggestions load, so they appear without moving the page. */
const PLACEHOLDERS = 3;

// 24px line glyphs, inline: a strict content security policy would block wa-icon's fetches.
const glyph = (paths: ReturnType<typeof svg>) =>
    html`<svg
        class="glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        ${paths}
    </svg>`;
const BY_MONTH = glyph(svg`<path d="M3 3v18h18"/><path d="M8 17v-4M12 17V9M16 17v-6M20 17V7"/>`);
const NET_RESULT = glyph(svg`<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>`);
const BREAKDOWN = glyph(
    svg`<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>`
);

function glyphOf({ intent }: Suggestion) {
    if (intent.monthly || intent.view === 'trend') return BY_MONTH;
    return intent.root === 'net-result' ? NET_RESULT : BREAKDOWN;
}

/**
 * Suggested reports as full-text cards, as the Bkper Agent home shows its starting points: in
 * a row when there is room, stacked as compact rows when narrow. Without `suggestions`, quiet
 * placeholders hold their place. Choosing one fires {@link CHOOSE_SUGGESTION}.
 *
 * The cards are native buttons: `wa-button` is a one-line control, and these wrap their text.
 */
@customElement('report-suggestions')
export class ReportSuggestions extends LitElement {
    static styles = css`
        :host {
            display: block;
            container-type: inline-size;
        }

        .suggestions {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: var(--wa-space-s);
            animation: fade var(--wa-transition-slow) var(--wa-transition-easing);
        }

        .suggestion {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: var(--wa-space-s);
            min-block-size: calc(var(--wa-space-scale) * 6rem);
            padding: var(--wa-space-s) var(--wa-space-m);
            border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
            border-radius: var(--wa-border-radius-l);
            background: transparent;
            color: var(--wa-color-text-normal);
            font: inherit;
            font-size: var(--wa-font-size-s);
            line-height: var(--wa-line-height-normal);
            text-align: start;
            cursor: pointer;
            transition:
                background-color var(--wa-transition-fast),
                border-color var(--wa-transition-fast);
        }

        .suggestion:hover {
            background: color-mix(in oklab, var(--wa-color-text-normal) 6%, transparent);
        }

        .suggestion:focus-visible {
            outline: var(--wa-focus-ring);
            outline-offset: var(--wa-focus-ring-offset);
        }

        .glyph {
            flex-shrink: 0;
            inline-size: calc(var(--wa-font-size-scale) * 1.125rem);
            block-size: calc(var(--wa-font-size-scale) * 1.125rem);
            color: var(--wa-color-brand-on-quiet);
        }

        .text {
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            overflow: hidden;
            overflow-wrap: anywhere;
        }

        .placeholder {
            cursor: default;
        }

        .placeholder .lines {
            display: grid;
            gap: var(--wa-space-xs);
            inline-size: 100%;
        }

        .placeholder wa-skeleton {
            block-size: var(--wa-space-s);
        }

        .placeholder wa-skeleton:last-child {
            inline-size: 60%;
        }

        .visually-hidden {
            position: absolute;
            inline-size: 1px;
            block-size: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
        }

        @container (max-width: 36rem) {
            .suggestions {
                grid-template-columns: 1fr;
                gap: var(--wa-space-xs);
            }

            .suggestion {
                flex-direction: row;
                align-items: center;
                min-block-size: calc(var(--wa-space-scale) * 2.75rem);
                padding: var(--wa-space-xs) var(--wa-space-s);
            }

            .text {
                -webkit-line-clamp: 2;
            }
        }

        @keyframes fade {
            from {
                opacity: 0;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .suggestions {
                animation: none;
            }
        }
    `;

    /** The suggestions, or `undefined` while they load. */
    @property({ attribute: false }) suggestions?: Suggestion[];
    /** Accessible name of the group. */
    @property() label = '';
    /** Announced while the suggestions load. */
    @property({ attribute: 'loading-label' }) loadingLabel = '';

    render() {
        const suggestions = this.suggestions;
        if (!suggestions) {
            return html`<div
                class="suggestions"
                role="group"
                aria-label=${this.label}
                aria-busy="true"
            >
                ${Array.from(
                    { length: PLACEHOLDERS },
                    () =>
                        html`<div class="suggestion placeholder" aria-hidden="true">
                            <wa-skeleton class="glyph" effect="sheen"></wa-skeleton>
                            <span class="lines">
                                <wa-skeleton effect="sheen"></wa-skeleton>
                                <wa-skeleton effect="sheen"></wa-skeleton>
                            </span>
                        </div>`
                )}
                <span class="visually-hidden">${this.loadingLabel}</span>
            </div>`;
        }
        if (suggestions.length === 0) return nothing;
        return html`<div class="suggestions" role="group" aria-label=${this.label}>
            ${repeat(
                suggestions,
                suggestion => suggestion.text,
                suggestion =>
                    html`<button
                        class="suggestion"
                        type="button"
                        title=${suggestion.text}
                        @click=${() => this.choose(suggestion)}
                    >
                        ${glyphOf(suggestion)}<span class="text">${suggestion.text}</span>
                    </button>`
            )}
        </div>`;
    }

    private choose(suggestion: Suggestion): void {
        this.dispatchEvent(
            new CustomEvent(CHOOSE_SUGGESTION, {
                detail: suggestion,
                bubbles: true,
                composed: true,
            })
        );
    }
}
