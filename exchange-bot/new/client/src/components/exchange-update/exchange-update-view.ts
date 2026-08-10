import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ExchangeRates } from '../../api/generated/types.js';
import {
    ExchangeUpdateController,
    type ExchangeUpdateResult,
    ExchangeUpdateStatus,
} from './exchange-update-controller.js';
import { exchangeUpdateCSS } from './exchange-update-css.js';
import { sharedCSS } from '../shared-css.js';

export interface BotAppBook {
    id: string;
    code: string | undefined;
    isBase: boolean;
    fractionDigits?: number;
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

    @property({ type: Boolean })
    disabled = false;

    @state()
    exchangeRates?: ExchangeRates;

    @state()
    ratesLoading = false;

    @state()
    ratesError = '';

    @state()
    executing = false;

    @state()
    results = new Map<string, ExchangeUpdateResult>();

    static styles = [sharedCSS, exchangeUpdateCSS];

    render(): TemplateResult {
        return html`
            <div class="intro">
                <h2>Exchange Update</h2>
                <p>Choose a date and review or adjust the exchange rates.</p>
                <p>
                    Then, click the <span>Run</span> button to keep balances in sync across your
                    connected currency Books.
                </p>
            </div>
            <wa-input
                class="date-input"
                type="date"
                label="Date"
                .value=${this.date}
                size="small"
                @change=${this.handleDateChanged}
                @blur=${this.handleDateBlurred}
            ></wa-input>
            ${this.renderRates()} ${this.renderActions()}
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
            <div class="rate">
                <wa-input
                    class="rate-input"
                    label=${code}
                    .value=${String(rate)}
                    size="small"
                    ?disabled=${disabled}
                    @change=${(event: Event) => this.handleRateChanged(code, event)}
                ></wa-input>
                ${this.renderExchangeUpdateResults(code)}
            </div>
        `;
    }

    private renderExchangeUpdateResults(code: string): TemplateResult {
        const books = this.books.filter(book => book.isBase && book.code === code);
        return html`${books.map(book => this.renderExchangeUpdateResult(book))}`;
    }

    private renderExchangeUpdateResult(book: BotAppBook): TemplateResult {
        const result = this.results.get(book.id);
        if (!result) {
            return html``;
        }
        if (result.status === ExchangeUpdateStatus.WAITING) {
            return html`<div class="update-result waiting"><wa-spinner></wa-spinner></div>`;
        }
        if (result.status === ExchangeUpdateStatus.ERROR) {
            return html`<div class="update-result error" role="alert">${result.error}</div>`;
        }
        return html`
            <div class="update-result complete">
                <wa-icon name="check_circle" label="Done"></wa-icon>
                <span>Done! ${result.summary}</span>
            </div>
        `;
    }

    private renderActions(): TemplateResult {
        if (this.disabled) {
            return html``;
        }
        const runDisabled = !this.exchangeRates || this.ratesLoading || this.executing;
        return html`
            <div class="actions">
                <wa-button
                    variant="brand"
                    appearance="accent"
                    size="small"
                    type="button"
                    ?disabled=${runDisabled}
                    @click=${this.handleRunClicked}
                >
                    Run
                </wa-button>
            </div>
        `;
    }

    private handleRunClicked(): void {
        this.controller.runExchangeUpdate();
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
