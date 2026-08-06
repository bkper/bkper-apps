import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { BotAppController, BotAppState } from './bot-app-controller.js';
import { botAppViewCSS } from './bot-app-view-css.js';

@customElement('bot-app-view')
export class BotAppView extends LitElement {
    private readonly controller = new BotAppController(this);

    @state()
    state = BotAppState.LOADING;

    @state()
    book?: Book;

    @state()
    date = '';

    @state()
    error = '';

    static styles = botAppViewCSS;

    render(): TemplateResult {
        return html`
            <div class="header">
                <wa-card appearance="outlined">
                    <h1 class="app-title">Exchange Bot</h1>
                    <p class="app-subtitle">Cloudflare migration shell</p>
                </wa-card>
            </div>
            <div class="body">${this.renderBody()}</div>
        `;
    }

    private renderBody(): TemplateResult {
        if (this.state === BotAppState.LOADING) {
            return html`<div class="centered"><wa-spinner></wa-spinner></div>`;
        }
        if (this.state === BotAppState.ERROR) {
            return html`<div class="error" role="alert">${this.error}</div>`;
        }
        if (this.book) {
            return html`
                <h2 class="book-name">${this.book.getName()}</h2>
                <wa-input
                    class="date-input"
                    type="date"
                    label="Date"
                    .value=${this.date}
                    @change=${this.handleDateChanged}
                ></wa-input>
            `;
        }
        return html``;
    }

    private handleDateChanged(event: Event): void {
        const input = event.currentTarget as WaInput;
        this.date = input.value ?? '';
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app-view': BotAppView;
    }
}
