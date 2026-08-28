import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PortfolioService, type AppError, type ForwardDateContext } from '../../types.js';
import { Utils } from '../../utils.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';
import { forwardDateCSS } from './forward-date-css.js';

@customElement('forward-date')
export class ForwardDateView extends LitElement {
    @property({ attribute: false })
    context?: ForwardDateContext;

    @property({ attribute: false })
    permissionError?: AppError;

    @property()
    date = '';

    static styles = [sharedCSS, forwardDateCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="forward-date">
                <service-switcher
                    .service=${PortfolioService.FORWARD_DATE}
                    .showMenu=${Utils.canSwitchServices(context)}
                    instructions="Review the accounts below before setting a forward date."
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
                        <wa-button variant="brand" appearance="accent" size="s" type="button">
                            Run
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
        'forward-date': ForwardDateView;
    }
}
