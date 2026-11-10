/**
 * The Source of a report, one line under the table: Details, which shows the exact dates and
 * query, when balances were read and the Book, and the link to Bkper. Whether Report calculated
 * the numbers stays visible above that line.
 */
import { html, nothing } from 'lit';
import { CHEVRON } from './breakdown.js';
import type { ReportFormat } from './format.js';
import type { PropsOf, ReportLink } from './spec-types.js';

/** The id of the Details panel, unique within a report's shadow root. */
const DETAILS_ID = 'source-details';

export interface SourceState {
    format: ReportFormat;
    /** Whether Details are shown; they are hidden until asked for. */
    open: boolean;
    onToggle(): void;
    /**
     * Handles the link to Bkper; without it, as where the report cannot navigate, the link is
     * left out.
     */
    onOpen?: (event: MouseEvent) => void;
    /** A plain link the host adds, such as a report file's link to the Report app. */
    link?: ReportLink;
}

export function renderSource(source: PropsOf<'Source'>, state: SourceState) {
    const { labels } = source;
    const { format, open, onOpen, link } = state;
    return html`
        <footer class="source">
            <h2 class="visually-hidden">${labels.source}</h2>
            ${
                source.calculated
                    ? html`<dl class="source-calculated">
                          <dt>${source.calculated.label}</dt>
                          <dd>${source.calculated.note}</dd>
                      </dl>`
                    : nothing
            }
            <div class="source-line">
                <button
                    class="toggle source-toggle"
                    type="button"
                    aria-expanded=${open ? 'true' : 'false'}
                    aria-controls=${DETAILS_ID}
                    @click=${() => state.onToggle()}
                >
                    <span class="chevron">${CHEVRON}</span>${labels.details ?? labels.source}
                </button>
                ${
                    onOpen
                        ? html`<a href=${source.url} target="_blank" rel="noopener" @click=${onOpen}
                              >${labels.open}</a
                          >`
                        : nothing
                }
                ${
                    link
                        ? html`<a href=${link.url} target="_blank" rel="noopener">${link.label}</a>`
                        : nothing
                }
            </div>
            <div id=${DETAILS_ID} class="source-details" ?hidden=${!open}>
                <dl class="source-facts">
                    <div>
                        <dt>${labels.period}</dt>
                        <dd>${source.period}</dd>
                    </div>
                    <div>
                        <dt>${labels.query}</dt>
                        <dd><code dir="ltr">${source.query}</code></dd>
                    </div>
                    <div>
                        <dt>${labels.dataAt}</dt>
                        <dd>${format.instant(source.dataAt)}</dd>
                    </div>
                </dl>
                <p class="source-footer">${source.footer}</p>
            </div>
        </footer>
    `;
}
