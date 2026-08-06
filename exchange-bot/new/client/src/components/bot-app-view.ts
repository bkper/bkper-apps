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
            return html`<h2 class="book-name">${this.book.getName()}</h2>`;
        }
        return html``;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app-view': BotAppView;
    }
}
