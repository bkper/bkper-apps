import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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

    @state()
    performMtm = false;

    @state()
    executing = false;

    static styles = [sharedCSS, realizedResultsCSS];

    render(): TemplateResult {
        const context = this.context;
        return html`
            <div class="realized-results">
                <service-switcher
                    .service=${PortfolioService.REALIZED_RESULTS}
                    .showMenu=${Utils.canSwitchServices(context)}
                    .disabled=${this.isServiceSwitcherDisabled()}
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
                    ?disabled=${this.isDateInputDisabled()}
                    size="s"
                    @input=${this.handleDateInputted}
                ></wa-input>
                <div class="mtm-container">
                    <wa-checkbox
                        .checked=${this.performMtm}
                        ?disabled=${this.isPerformMtmCheckboxDisabled()}
                        size="s"
                        @change=${this.handlePerformMtmChanged}
                    >
                        Perform MTM valuations
                    </wa-checkbox>
                </div>
                <div class="actions">
                    ${this.renderPermissionError()}
                    <div class="action-buttons">
                        <wa-button
                            appearance="outlined"
                            size="s"
                            type="button"
                            ?disabled=${this.isResetButtonDisabled()}
                            @click=${this.handleResetClicked}
                        >
                            Reset
                        </wa-button>
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
        return this.executing;
    }

    private isPerformMtmCheckboxDisabled(): boolean {
        return this.executing;
    }

    private isResetButtonDisabled(): boolean {
        return (
            this.executing ||
            this.permissionError !== undefined ||
            !this.context?.accounts.length ||
            this.context.resetEnabled !== true
        );
    }

    private isCalculateButtonDisabled(): boolean {
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

    private handlePerformMtmChanged(event: Event): void {
        if (this.isPerformMtmCheckboxDisabled()) {
            return;
        }
        const checkbox = event.currentTarget as WaCheckbox;
        this.performMtm = checkbox.checked;
    }

    private handleResetClicked(): void {
        // TODO: implement
    }

    private handleCalculateClicked(): void {
        // TODO: implement
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'realized-results': RealizedResultsView;
    }
}
