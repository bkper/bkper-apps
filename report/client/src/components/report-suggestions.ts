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
        slot="start"
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
 * Suggested reports as chips just over the input, one line each, wrapping when there is no
 * room. Without `suggestions`, quiet placeholders hold their place; the chips fade in when they
 * arrive. Choosing one fires {@link CHOOSE_SUGGESTION}.
 */
@customElement('report-suggestions')
export class ReportSuggestions extends LitElement {
    static styles = css`
        :host {
            display: block;
        }

        .suggestions {
            display: flex;
            flex-wrap: wrap;
            gap: var(--wa-space-xs);
        }

        .suggestions.ready {
            animation: fade var(--wa-transition-slow) var(--wa-transition-easing);
        }

        .suggestion {
            max-inline-size: 100%;
        }

        .suggestion::part(button) {
            max-inline-size: 100%;
            color: var(--wa-color-text-normal);
        }

        .suggestion::part(label) {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .glyph {
            flex-shrink: 0;
            inline-size: 1.15em;
            block-size: 1.15em;
            color: var(--wa-color-brand-on-quiet);
        }

        .placeholder {
            inline-size: calc(var(--wa-space-scale) * 11rem);
            block-size: var(--wa-form-control-height);
            font-size: var(--wa-font-size-s);
            --color: var(--wa-color-neutral-fill-quiet);
        }

        .placeholder::part(indicator) {
            border-radius: var(--wa-border-radius-pill);
        }

        .visually-hidden {
            position: absolute;
            inline-size: 1px;
            block-size: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
        }

        @keyframes fade {
            from {
                opacity: 0;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .suggestions.ready {
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
                        html`<wa-skeleton
                            class="placeholder"
                            effect="sheen"
                            aria-hidden="true"
                        ></wa-skeleton>`
                )}
                <span class="visually-hidden">${this.loadingLabel}</span>
            </div>`;
        }
        if (suggestions.length === 0) return nothing;
        return html`<div class="suggestions ready" role="group" aria-label=${this.label}>
            ${repeat(
                suggestions,
                suggestion => suggestion.text,
                suggestion =>
                    html`<wa-button
                        class="suggestion"
                        size="s"
                        pill
                        appearance="outlined"
                        variant="neutral"
                        title=${suggestion.text}
                        @click=${() => this.choose(suggestion)}
                    >
                        ${glyphOf(suggestion)}${suggestion.text}
                    </wa-button>`
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
