/** The Source of a report: the Book, the exact dates and query, and when balances were read. */
import { html, nothing } from 'lit';
import type { ReportFormat } from './format.js';
import type { PropsOf } from './spec-types.js';

/**
 * @param onOpen Handles the link to Bkper; without it, as where the report cannot navigate, the
 *   link is left out.
 */
export function renderSource(
    source: PropsOf<'Source'>,
    format: ReportFormat,
    onOpen?: (event: MouseEvent) => void
) {
    const { labels } = source;
    return html`
        <footer class="source">
            <h2 class="source-title">${labels.source}</h2>
            <dl class="source-facts">
                <div>
                    <dt>${labels.period}</dt>
                    <dd dir="auto">${source.period}</dd>
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
            <p class="source-footer">
                <span>${source.footer}</span>
                ${
                    onOpen
                        ? html`<a href=${source.url} target="_blank" rel="noopener" @click=${onOpen}
                              >${labels.open}</a
                          >`
                        : nothing
                }
            </p>
        </footer>
    `;
}
