import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

/** The event a chosen suggestion fires, bubbling to the page. */
export const CHOOSE_SUGGESTION = 'report-choose-suggestion';

declare global {
    interface HTMLElementEventMap {
        [CHOOSE_SUGGESTION]: CustomEvent<string>;
    }
    interface HTMLElementTagNameMap {
        'report-suggestions': ReportSuggestions;
    }
}

/** Placeholders while the suggestions load, so they appear without moving the page. */
const PLACEHOLDERS = 3;

/**
 * Suggested reports as chips just over the input, in the shelf's sideways-scrolling row.
 * Without `suggestions`, quiet placeholders hold their place; the chips fade in when they arrive. Choosing one fires {@link CHOOSE_SUGGESTION}.
 */
@customElement('report-suggestions')
export class ReportSuggestions extends LitElement {
    static styles = css`
        :host {
            display: block;
        }

        .suggestions {
            display: flex;
            flex-wrap: nowrap;
            gap: var(--wa-space-xs);
        }

        .suggestions.ready {
            animation: fade var(--wa-transition-slow) var(--wa-transition-easing);
        }

        .suggestion {
            max-inline-size: min(32ch, 55vw);
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

    /** The suggestions, as requests, or `undefined` while they load. */
    @property({ attribute: false }) suggestions?: string[];
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
                suggestion => suggestion,
                suggestion =>
                    html`<wa-button
                        class="suggestion"
                        size="s"
                        pill
                        appearance="outlined"
                        variant="neutral"
                        title=${suggestion}
                        @click=${() => this.choose(suggestion)}
                    >
                        ${suggestion}
                    </wa-button>`
            )}
        </div>`;
    }

    private choose(suggestion: string): void {
        this.dispatchEvent(
            new CustomEvent(CHOOSE_SUGGESTION, {
                detail: suggestion,
                bubbles: true,
                composed: true,
            })
        );
    }
}
