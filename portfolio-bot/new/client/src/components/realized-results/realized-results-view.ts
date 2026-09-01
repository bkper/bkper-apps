import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
    PortfolioService,
    type AccountOperationResult,
    type AppError,
    type RealizedResultsContext,
} from '../../types.js';
import { Utils } from '../../utils.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import '../service-switcher/service-switcher-view.js';
import { sharedCSS } from '../shared-css.js';
import { RealizedResultsController } from './realized-results-controller.js';
import { realizedResultsCSS } from './realized-results-css.js';

@customElement('realized-results')
export class RealizedResultsView extends LitElement {
    private readonly controller = new RealizedResultsController(this);

    @property({ attribute: false })
    context?: RealizedResultsContext;

    @property({ attribute: false })
    permissionError?: AppError;

    @property()
    date = '';

    @state()
    performMtm = false;

    @state()
    executing = false;

    @state()
    operationError?: AppError;

    @state()
    results = new Map<string, AccountOperationResult>();

    static styles = [sharedCSS, realizedResultsCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="realized-results">
                <!-- Service switcher -->
                <service-switcher
                    .service=${PortfolioService.REALIZED_RESULTS}
                    .showMenu=${Utils.canSwitchServices(context)}
                    .disabled=${this.isServiceSwitcherDisabled()}
                    instructions="Review the accounts below before running an operation."
                ></service-switcher>

                <!-- Account list -->
                <account-list
                    .accounts=${context?.accounts ?? []}
                    .selectedAccount=${context?.selectedAccount}
                    .selectedGroup=${context?.selectedGroup}
                    .results=${this.results}
                ></account-list>

                <!-- Date input -->
                ${this.renderDateInput()}
                <!-- Mtm checkbox -->
                <div class="mtm-container">${this.renderMtmCheckbox()}</div>

                <!-- Buttons -->
                <div class="actions">
                    ${this.renderPermissionError()} ${this.renderOperationError()}
                    <div class="action-buttons">
                        ${this.renderResetButton()} ${this.renderCalculateButton()}
                    </div>
                </div>
            </div>
        `;
    }

    private renderDateInput(): TemplateResult {
        return html`
            <wa-input
                class="date-input"
                type="date"
                label="Date"
                .value=${this.date}
                ?disabled=${this.isDateInputDisabled()}
                size="s"
                @input=${this.handleDateInputted}
            ></wa-input>
        `;
    }

    private renderMtmCheckbox(): TemplateResult {
        return html`
            <wa-checkbox
                .checked=${this.performMtm}
                ?disabled=${this.isPerformMtmCheckboxDisabled()}
                size="s"
                @change=${this.handlePerformMtmChanged}
            >
                Perform MTM valuations
            </wa-checkbox>
        `;
    }

    private renderResetButton(): TemplateResult {
        return html`
            <wa-button
                appearance="outlined"
                size="s"
                type="button"
                ?disabled=${this.isResetButtonDisabled()}
                @click=${this.handleResetClicked}
            >
                Reset
            </wa-button>
        `;
    }

    private renderCalculateButton(): TemplateResult {
        return html`
            <wa-button
                variant="brand"
                appearance="accent"
                size="s"
                type="button"
                ?disabled=${this.isCalculateButtonDisabled()}
                @click=${this.handleCalculateClicked}
            >
                Calculate
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

    private isPerformMtmCheckboxDisabled(): boolean {
        return this.isExecuting() || !this.context?.accounts.length;
    }

    private shouldDisableButton(): boolean {
        return (
            this.isExecuting() ||
            this.permissionError !== undefined ||
            !this.context?.accounts.length
        );
    }

    private isResetButtonDisabled(): boolean {
        return this.shouldDisableButton() || this.context?.resetEnabled !== true;
    }

    private isCalculateButtonDisabled(): boolean {
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

    private handlePerformMtmChanged(event: Event): void {
        if (this.isPerformMtmCheckboxDisabled()) {
            return;
        }
        const checkbox = event.currentTarget as WaCheckbox;
        this.performMtm = checkbox.checked;
        this.controller.clearResults();
    }

    private handleResetClicked(): void {
        if (this.isResetButtonDisabled()) {
            return;
        }
        this.controller.runReset();
    }

    private handleCalculateClicked(): void {
        if (this.isCalculateButtonDisabled()) {
            return;
        }
        this.controller.runCalculate();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'realized-results': RealizedResultsView;
    }
}
