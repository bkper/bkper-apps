import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
    PortfolioService,
    type AccountOperationResult,
    type AppError,
    type ForwardDateContext,
} from '../../types.js';
import { Utils } from '../../utils.js';
import type { ConfirmationDialogView } from '../confirmation-dialog/confirmation-dialog-view.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../confirmation-dialog/confirmation-dialog-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';
import { ForwardDateController } from './forward-date-controller.js';
import { forwardDateCSS } from './forward-date-css.js';

@customElement('forward-date')
export class ForwardDateView extends LitElement {
    private readonly controller = new ForwardDateController(this);

    @property({ attribute: false })
    context?: ForwardDateContext;

    @property({ attribute: false })
    permissionError?: AppError;

    @property()
    date = '';

    @state()
    executing = false;

    @state()
    operationError?: AppError;

    @state()
    results = new Map<string, AccountOperationResult>();

    @query('confirmation-dialog')
    private forwardConfirmationDialog?: ConfirmationDialogView;

    static styles = [sharedCSS, forwardDateCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="forward-date">
                <!-- Service switcher -->
                <service-switcher
                    .service=${PortfolioService.FORWARD_DATE}
                    .showMenu=${Utils.canSwitchServices(context)}
                    .disabled=${this.isServiceSwitcherDisabled()}
                    instructions="Review the accounts below before setting a forward date."
                ></service-switcher>

                <!-- Account list -->
                <account-list
                    .accounts=${context?.accounts ?? []}
                    .selectedAccount=${context?.selectedAccount}
                    .selectedGroup=${context?.selectedGroup}
                    .results=${this.results}
                ></account-list>

                <!-- Date input -->
                <wa-input
                    class="date-input"
                    type="date"
                    label="Date"
                    .value=${this.date}
                    ?disabled=${this.isDateInputDisabled()}
                    size="s"
                    @input=${this.handleDateInputted}
                ></wa-input>

                <!-- Buttons -->
                <div class="actions">
                    ${this.renderPermissionError()} ${this.renderOperationError()}
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

                <!-- Forward Date confirmation -->
                ${this.renderForwardConfirmationDialog()}
            </div>
        `;
    }

    private renderForwardConfirmationDialog(): TemplateResult {
        const context = this.context;
        if (!context?.accounts.length || !this.date) {
            return html``;
        }
        const accountLabel = `${context.accounts.length} ${context.accounts.length === 1 ? 'account' : 'accounts'}`;
        const confirmationText = `Set Forward Date to ${this.date} for ${accountLabel}?`;
        return html`
            <confirmation-dialog
                .headerLabel=${'Confirm Forward Date'}
                .message=${confirmationText}
                .actionLabel=${'Run'}
                @confirmed=${this.handleForwardConfirmed}
            ></confirmation-dialog>
        `;
    }

    private renderPermissionError(): TemplateResult {
        if (!this.permissionError) {
            return html``;
        }
        return this.renderError(this.permissionError);
    }

    private renderOperationError(): TemplateResult {
        if (!this.operationError) {
            return html``;
        }
        return this.renderError(this.operationError);
    }

    private renderError(error: AppError): TemplateResult {
        return html`<app-error .error=${error}></app-error>`;
    }

    private isExecuting(): boolean {
        return this.executing;
    }

    private isServiceSwitcherDisabled(): boolean {
        return this.isExecuting();
    }

    private isDateInputDisabled(): boolean {
        return this.isExecuting() || !this.context?.accounts.length;
    }

    private isRunButtonDisabled(): boolean {
        return (
            this.isExecuting() ||
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
        this.controller.clearResults();
    }

    private handleRunClicked(): void {
        if (this.isRunButtonDisabled()) {
            return;
        }
        this.forwardConfirmationDialog?.show();
    }

    private handleForwardConfirmed(): void {
        if (this.isRunButtonDisabled()) {
            return;
        }
        this.controller.runForward();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'forward-date': ForwardDateView;
    }
}
