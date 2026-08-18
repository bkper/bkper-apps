import type WaPopover from '@awesome.me/webawesome/dist/components/popover/popover.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { exchangeUpdateResultCSS } from './exchange-update-result-css.js';
import { sharedCSS } from '../../shared-css.js';
import type { ExchangeUpdateSummary } from '../../../types.js';

@customElement('exchange-update-result')
export class ExchangeUpdateResultView extends LitElement {
    @property({ attribute: false })
    summary?: ExchangeUpdateSummary = {};

    @query('.popover')
    private resultPopover?: WaPopover;

    static styles = [sharedCSS, exchangeUpdateResultCSS];

    render(): TemplateResult {
        return html`
            <div class="container">
                <wa-icon name="check_circle" label="Done"></wa-icon>
                <span>Done!</span>
                <button
                    id="result-trigger"
                    class="trigger focusable"
                    type="button"
                    @mouseenter=${this.openResult}
                    @click=${this.handleTriggerClicked}
                >
                    Result
                </button>
                <wa-popover class="popover" for="result-trigger" placement="bottom-start">
                    <div class="content">${this.renderSummary()}</div>
                </wa-popover>
            </div>
        `;
    }

    private openResult(): void {
        this.resultPopover?.show();
    }

    private handleTriggerClicked(e: Event): void {
        e.stopImmediatePropagation();
        this.openResult();
    }

    private renderSummary(): TemplateResult {
        const summary = this.summary ?? {};
        const entries = Object.entries(summary);
        if (entries.length === 0) {
            return html`<p class="empty-result">No transactions were created.</p>`;
        }
        return html`
            <dl class="result-list">
                ${entries.map(
                    ([accountName, amount]) => html`
                        <div class="result-row">
                            <dt title="${accountName}">${accountName}</dt>
                            <dd title="${amount}">${amount}</dd>
                        </div>
                    `
                )}
            </dl>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'exchange-update-result': ExchangeUpdateResultView;
    }
}
