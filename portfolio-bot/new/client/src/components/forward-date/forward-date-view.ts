import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PortfolioService, type AppError, type ForwardDateContext } from '../../types.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';

@customElement('forward-date')
export class ForwardDateView extends LitElement {
    @property({ attribute: false })
    context?: ForwardDateContext;

    @property({ attribute: false })
    permissionError?: AppError;

    static styles = [sharedCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="forward-date">
                <service-switcher
                    .service=${PortfolioService.FORWARD_DATE}
                    instructions="Review the accounts below before setting a forward date."
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
        'forward-date': ForwardDateView;
    }
}
