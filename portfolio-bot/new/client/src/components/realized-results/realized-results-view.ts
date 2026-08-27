import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PortfolioService, type AppError, type RealizedResultsContext } from '../../types.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';

@customElement('realized-results')
export class RealizedResultsView extends LitElement {
    @property({ attribute: false })
    context?: RealizedResultsContext;

    @property({ attribute: false })
    permissionError?: AppError;

    static styles = [sharedCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="realized-results">
                <service-switcher
                    .service=${PortfolioService.REALIZED_RESULTS}
                    instructions="Review the accounts below before running an operation."
                ></service-switcher>
                <account-list
                    .accounts=${context?.accounts ?? []}
                    .selectedAccount=${context?.selectedAccount}
                    .selectedGroup=${context?.selectedGroup}
                ></account-list>
                ${this.renderPermissionError()}
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
