import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import type { ExchangeBotBook } from '../types.js';
import './exchange-update/exchange-update-view.js';
import { BotAppController, BotAppState } from './bot-app-controller.js';
import { botAppCSS } from './bot-app-css.js';
import { sharedCSS } from './shared-css.js';

@customElement('bot-app')
export class BotAppView extends LitElement {
    private readonly controller = new BotAppController(this);

    @state()
    embedded = false;

    @state()
    appState = BotAppState.LOADING;

    @state()
    error = '';

    @state()
    book?: Book;

    @state()
    initialDate = '';

    @state()
    books: ExchangeBotBook[] = [];

    @state()
    hasViewerPermission = false;

    @state()
    hasEditorPermission = false;

    @state()
    permissionError = '';

    @state()
    warnings: string[] = [];

    static styles = [sharedCSS, botAppCSS];

    render(): TemplateResult {
        return html`
            ${this.renderHeader()}
            <div class="body">${this.renderBodyContent()}</div>
        `;
    }

    private renderHeader(): TemplateResult {
        if (this.embedded) {
            return html``;
        }
        return html`<app-header .book=${this.book}></app-header>`;
    }

    private renderBodyContent(): TemplateResult {
        if (this.appState === BotAppState.LOADING) {
            return html`<div class="centered"><wa-spinner></wa-spinner></div>`;
        }
        if (this.appState === BotAppState.ERROR) {
            return html`<div class="error" role="alert">${this.error}</div>`;
        }
        if (this.book && !this.hasViewerPermission) {
            return this.renderPermissionError();
        }
        if (this.book) {
            return html`
                <exchange-update
                    .book=${this.book}
                    .books=${this.books}
                    .date=${this.initialDate}
                    .hasPermission=${this.hasEditorPermission}
                    .permissionError=${this.permissionError}
                ></exchange-update>
                ${this.renderWarnings()}
            `;
        }
        return html``;
    }

    private renderPermissionError(): TemplateResult {
        if (!this.permissionError) {
            return html``;
        }
        return html`<div class="error" role="alert">${this.permissionError}</div>`;
    }

    private renderWarnings(): TemplateResult {
        if (this.warnings.length === 0) {
            return html``;
        }
        return html`
            <section class="warnings">
                <div class="warnings-title">
                    <wa-icon name="warning" label="Warnings"></wa-icon>
                    <span>Warnings</span>
                </div>
                <div class="warnings-list">
                    ${this.warnings.map(w => html`<div class="warning" role="status">${w}</div>`)}
                </div>
            </section>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
