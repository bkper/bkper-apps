import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import type { BotAppBook } from './exchange-update/exchange-update-view.js';
import './exchange-update/exchange-update-view.js';
import { BotAppController, BotAppState } from './bot-app-controller.js';
import { botAppViewCSS } from './bot-app-view-css.js';
import { sharedCSS } from './shared-css.js';

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
    initialDate = '';

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
                <exchange-update
                    .book=${this.book}
                    .books=${this.books}
                    .date=${this.initialDate}
                    .disabled=${!this.basePermissionGranted}
                ></exchange-update>
                ${this.renderPermissionError()}
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
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
