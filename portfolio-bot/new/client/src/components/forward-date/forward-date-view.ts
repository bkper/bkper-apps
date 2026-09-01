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
import type {
    ConfirmationDialogOptions,
    ConfirmationDialogView,
} from '../confirmation-dialog/confirmation-dialog-view.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../confirmation-dialog/confirmation-dialog-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';
import { ForwardDateController } from './forward-date-controller.js';
import { forwardDateCSS } from './forward-date-css.js';

enum ConfirmationAction {
    FORWARD = 'forward',
    FULL_RESET = 'full-reset',
}

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

    @query('.confirmation-dialog')
    private confirmationDialog?: ConfirmationDialogView;

    private pendingConfirmation?: ConfirmationAction;

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

                <!-- Confirmation -->
                <confirmation-dialog
                    class="confirmation-dialog"
                    @confirmed=${this.handleConfirmedEvent}
                ></confirmation-dialog>
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
                ?disabled=${this.isForwardButtonDisabled()}
                @click=${this.handleRunClicked}
            >
                Forward
            </wa-button>
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

    private isForwardButtonDisabled(): boolean {
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
        this.showConfirmation(ConfirmationAction.FULL_RESET, {
            headerLabel: 'Confirm Full Reset',
            message: `Full Reset will remove ALL realized results and forward states for ${this.getAccountLabel()}. This operation cannot be undone.`,
            actionLabel: 'Full Reset',
            confirmationPhrase: 'FULL RESET',
        });
    }

    private handleRunClicked(): void {
        if (this.isForwardButtonDisabled()) {
            return;
        }
        this.showConfirmation(ConfirmationAction.FORWARD, {
            headerLabel: 'Confirm Forward Date',
            message: `Set Forward Date to ${this.date} for ${this.getAccountLabel()}?`,
            actionLabel: 'Forward',
        });
    }

    private getAccountLabel(): string {
        const accountCount = this.context?.accounts.length ?? 0;
        return `${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}`;
    }

    private showConfirmation(action: ConfirmationAction, options: ConfirmationDialogOptions): void {
        if (!this.confirmationDialog) {
            return;
        }
        this.pendingConfirmation = action;
        this.confirmationDialog.show(options);
    }

    private handleConfirmedEvent(): void {
        const action = this.pendingConfirmation;
        this.pendingConfirmation = undefined;
        if (action === ConfirmationAction.FULL_RESET) {
            this.runFullReset();
        } else if (action === ConfirmationAction.FORWARD) {
            this.runForward();
        }
    }

    private runFullReset(): void {
        if (this.isFullResetButtonDisabled()) {
            return;
        }
        this.controller.runFullReset();
    }

    private runForward(): void {
        if (this.isForwardButtonDisabled()) {
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
