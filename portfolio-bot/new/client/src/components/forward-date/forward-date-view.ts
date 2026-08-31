import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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

    @state()
    executing = false;

    static styles = [sharedCSS, forwardDateCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="forward-date">
                <service-switcher
                    .service=${PortfolioService.FORWARD_DATE}
                    .showMenu=${Utils.canSwitchServices(context)}
                    .disabled=${this.isServiceSwitcherDisabled()}
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
                    ?disabled=${this.isDateInputDisabled()}
                    size="s"
                    @input=${this.handleDateInputted}
                ></wa-input>
                <div class="actions">
                    ${this.renderPermissionError()}
                    <div class="action-buttons">
                        <wa-button
                            variant="brand"
                            appearance="accent"
                            size="s"
                            type="button"
                            ?disabled=${this.isRunButtonDisabled()}
                            @click=${this.handleRunClicked}
                        >
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

    private isServiceSwitcherDisabled(): boolean {
        return this.executing;
    }

    private isDateInputDisabled(): boolean {
        return this.executing || !this.context?.accounts.length;
    }

    private isRunButtonDisabled(): boolean {
        return (
            this.executing ||
            this.permissionError !== undefined ||
            !this.context?.accounts.length ||
            !this.date
        );
    }

    private handleDateInputted(event: Event): void {
        if (this.isDateInputDisabled()) {
            return;
        }
        const input = event.currentTarget as WaInput;
        this.date = input.value ?? '';
    }

    private handleRunClicked(): void {
        // TODO: implement
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'forward-date': ForwardDateView;
    }
}
