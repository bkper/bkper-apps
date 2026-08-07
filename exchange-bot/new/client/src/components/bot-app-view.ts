import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ExchangeRates } from '../api/generated/types.js';
import './app-header/app-header-view.js';
import { BotAppController, BotAppState } from './bot-app-controller.js';
import { botAppViewCSS } from './bot-app-view-css.js';
import { sharedCSS } from './shared-css.js';

export interface BotAppBook {
    id: string;
    code: string | undefined;
    base: boolean;
}

@customElement('bot-app')
export class BotAppView extends LitElement {
    private readonly controller = new BotAppController(this);

    @state()
    appState = BotAppState.LOADING;

    @state()
    error = '';

    @state()
    book?: Book;

    @state()
    date = '';

    @state()
    exchangeRates?: ExchangeRates;

    @state()
    ratesLoading = false;

    @state()
    ratesError = '';

    @state()
    books: BotAppBook[] = [];

    @state()
    basePermissionGranted = false;

    @state()
    permissionGranted = false;

    @state()
    permissionError = '';

    static styles = [sharedCSS, botAppViewCSS];

    render(): TemplateResult {
        return html`
            <app-header .book=${this.book}></app-header>
            <div class="body">${this.renderBody()}</div>
        `;
    }

    private renderBody(): TemplateResult {
        if (this.appState === BotAppState.LOADING) {
            return html`<div class="centered"><wa-spinner></wa-spinner></div>`;
        }
        if (this.appState === BotAppState.ERROR) {
            return html`<div class="error" role="alert">${this.error}</div>`;
        }
        if (this.book) {
            return html`
                <wa-input
                    class="date-input"
                    type="date"
                    label="Date"
                    .value=${this.date}
                    @change=${this.handleDateChanged}
                    @blur=${this.handleDateBlurred}
                ></wa-input>
                ${this.renderRates()} ${this.renderPermissionError()}
            `;
        }
        return html``;
    }

    private renderPermissionError(): TemplateResult {
        if (!this.permissionError) {
            return html``;
        }
        return html`<div class="error permission-error" role="alert">${this.permissionError}</div>`;
    }

    private renderRates(): TemplateResult {
        if (this.ratesLoading) {
            return html`
                <div class="rates-loading">
                    <wa-spinner></wa-spinner>
                    <span>Loading exchange rates...</span>
                </div>
            `;
        }
        if (this.ratesError) {
            return html`<div class="error rates-error" role="alert">${this.ratesError}</div>`;
        }
        if (this.exchangeRates) {
            const rates = Object.entries(this.exchangeRates.rates);
            return html`
                <div class="rates">
                    ${this.renderRate(this.exchangeRates.base, '1', true)}
                    ${rates.map(([code, rate]) => this.renderRate(code, rate))}
                </div>
            `;
        }
        return html``;
    }

    private renderRate(code: string, rate: number | string, disabled = false): TemplateResult {
        return html`
            <wa-input
                class="rate-input"
                label=${code}
                .value=${String(rate)}
                ?disabled=${disabled}
                @change=${(event: Event) => this.handleRateChanged(code, event)}
            ></wa-input>
        `;
    }

    private handleDateChanged(event: Event): void {
        const input = event.currentTarget as WaInput;
        this.date = input.value ?? '';
    }

    private handleDateBlurred(): void {
        this.controller.loadRates();
    }

    private handleRateChanged(code: string, event: Event): void {
        if (!this.exchangeRates) {
            return;
        }
        const input = event.currentTarget as WaInput;
        if (code in this.exchangeRates.rates) {
            this.exchangeRates.rates[code] = input.value ?? '';
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
