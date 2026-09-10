import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
    type AccountOperationResult,
    type AppError,
    type CostOfGoodsSoldContext,
} from '../../types.js';
import '../account-list/account-list-view.js';
import '../app-error/app-error-view.js';
import { sharedCSS } from '../shared-css.js';
import { CostOfGoodsSoldController } from './cost-of-goods-sold-controller.js';
import { costOfGoodsSoldCSS } from './cost-of-goods-sold-css.js';

@customElement('cost-of-goods-sold')
export class CostOfGoodsSoldView extends LitElement {
    private readonly controller = new CostOfGoodsSoldController(this);

    @property({ attribute: false })
    context?: CostOfGoodsSoldContext;

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

    static styles = [sharedCSS, costOfGoodsSoldCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="cost-of-goods-sold">
                <!-- Intro -->
                <div class="intro">
                    <h2>Cost of Goods Sold</h2>
                    <p>Choose a date and review the accounts below.</p>
                    <p>
                        Then, click <span>Calculate</span> to calculate cost of goods sold using
                        FIFO, or <span>Reset</span> to undo already calculated results.
                    </p>
                </div>

                <!-- Account list -->
                <account-list
                    .accounts=${context?.accounts ?? []}
                    .selectedAccount=${context?.selectedAccount}
                    .selectedGroup=${context?.selectedGroup}
                    .results=${this.results}
                ></account-list>

                <!-- Date input -->
                ${this.renderDateInput()}

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
        'cost-of-goods-sold': CostOfGoodsSoldView;
    }
}
