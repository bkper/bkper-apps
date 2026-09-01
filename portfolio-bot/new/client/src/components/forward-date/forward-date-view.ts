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

    @query('.full-reset-confirmation')
    private fullResetConfirmationDialog?: ConfirmationDialogView;

    @query('.forward-confirmation')
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
                        ${this.renderFullResetButton()} ${this.renderForwardButton()}
                    </div>
                </div>

                <!-- Confirmations -->
                ${this.renderFullResetConfirmationDialog()}
                ${this.renderForwardConfirmationDialog()}
            </div>
        `;
    }

    private renderFullResetButton(): TemplateResult {
        if (!this.context?.fullResetEnabled) {
            return html``;
        }
        return html`
            <wa-button
                variant="danger"
                appearance="outlined"
                size="s"
                type="button"
                ?disabled=${this.isFullResetButtonDisabled()}
                @click=${this.handleFullResetClicked}
            >
                Full Reset
            </wa-button>
        `;
    }

    private renderForwardButton(): TemplateResult {
        return html`
            <wa-button
                variant="brand"
                appearance="accent"
                size="s"
                type="button"
                ?disabled=${this.isRunButtonDisabled()}
                @click=${this.handleRunClicked}
            >
                Forward
            </wa-button>
        `;
    }

    private renderFullResetConfirmationDialog(): TemplateResult {
        const context = this.context;
        if (!context?.fullResetEnabled) {
            return html``;
        }
        const accountLabel = `${context.accounts.length} ${context.accounts.length === 1 ? 'account' : 'accounts'}`;
        const confirmationText = `Full Reset will remove ALL realized results and forward states for ${accountLabel}. This operation cannot be undone.`;
        return html`
            <confirmation-dialog
                class="full-reset-confirmation"
                .headerLabel=${'Confirm Full Reset'}
                .message=${confirmationText}
                .actionLabel=${'Full Reset'}
                .confirmationPhrase=${'FULL RESET'}
                @confirmed=${this.handleFullResetConfirmed}
            ></confirmation-dialog>
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
                class="forward-confirmation"
                .headerLabel=${'Confirm Forward Date'}
                .message=${confirmationText}
                .actionLabel=${'Forward'}
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

    private shouldDisableButton(): boolean {
        return (
            this.isExecuting() ||
            this.permissionError !== undefined ||
            !this.context?.accounts.length
        );
    }

    private isFullResetButtonDisabled(): boolean {
        return this.shouldDisableButton() || this.context?.fullResetEnabled !== true;
    }

    private isRunButtonDisabled(): boolean {
        return this.shouldDisableButton() || !this.date;
    }

    private handleDateInputted(event: Event): void {
        if (this.isDateInputDisabled()) {
            return;
        }
        const input = event.currentTarget as WaInput;
        this.date = input.value ?? '';
        this.controller.clearResults();
    }

    private handleFullResetClicked(): void {
        if (this.isFullResetButtonDisabled()) {
            return;
        }
        this.fullResetConfirmationDialog?.show();
    }

    private handleFullResetConfirmed(): void {
        if (this.isFullResetButtonDisabled()) {
            return;
        }
        this.controller.runFullReset();
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
