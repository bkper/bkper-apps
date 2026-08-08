import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ExchangeRates } from '../../api/generated/types.js';
import { ExchangeUpdateController } from './exchange-update-controller.js';
import { exchangeUpdateCSS } from './exchange-update-view-css.js';
import { sharedCSS } from '../shared-css.js';

export interface BotAppBook {
    id: string;
    code: string | undefined;
    base: boolean;
}

@customElement('exchange-update')
export class ExchangeUpdateView extends LitElement {
    private readonly controller = new ExchangeUpdateController(this);

    @property({ attribute: false })
    book?: Book;

    @property({ attribute: false })
    books: BotAppBook[] = [];

    @property({ attribute: false })
    date = '';

    @state()
    exchangeRates?: ExchangeRates;

    @state()
    ratesLoading = false;

    @state()
    ratesError = '';

    static styles = [sharedCSS, exchangeUpdateCSS];

    render(): TemplateResult {
        return html`
            <wa-input
                class="date-input"
                type="date"
                label="Date"
                .value=${this.date}
                @change=${this.handleDateChanged}
                @blur=${this.handleDateBlurred}
            ></wa-input>
            ${this.renderRates()}
        `;
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
        'exchange-update': ExchangeUpdateView;
    }
}
