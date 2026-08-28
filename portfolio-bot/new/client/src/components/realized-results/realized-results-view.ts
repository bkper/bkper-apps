import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PortfolioService, type AppError, type RealizedResultsContext } from '../../types.js';
import { Utils } from '../../utils.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';
import { realizedResultsCSS } from './realized-results-css.js';

@customElement('realized-results')
export class RealizedResultsView extends LitElement {
    @property({ attribute: false })
    context?: RealizedResultsContext;

    @property({ attribute: false })
    permissionError?: AppError;

    @property()
    date = '';

    static styles = [sharedCSS, realizedResultsCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="realized-results">
                <service-switcher
                    .service=${PortfolioService.REALIZED_RESULTS}
                    .showMenu=${Utils.canSwitchServices(context)}
                    instructions="Review the accounts below before running an operation."
                ></service-switcher>
                <account-list
                    .accounts=${context?.accounts ?? []}
                    .selectedAccount=${context?.selectedAccount}
                    .selectedGroup=${context?.selectedGroup}
                ></account-list>
                <wa-input
                    class="date-input"
                    type="date"
                    label="Date"
                    .value=${this.date}
                    size="s"
                ></wa-input>
                <div class="actions">
                    ${this.renderPermissionError()}
                    <div class="action-buttons">
                        <wa-button appearance="outlined" size="s" type="button">Reset</wa-button>
                        <wa-button variant="brand" appearance="accent" size="s" type="button">
                            Calculate
                        </wa-button>
                    </div>
                </div>
            </div>
        `;
    }

    private renderPermissionError(): TemplateResult {
        if (!this.permissionError) {
            return html``;
        }
        return html`<app-error .error=${this.permissionError}></app-error>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'realized-results': RealizedResultsView;
    }
}
