import type { App, Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import './app-error/app-error-view.js';
import './cost-of-goods-sold/cost-of-goods-sold-view.js';
import {
    BotAppState,
    type AppError,
    type ExecutionChangeEvent,
    type CostOfGoodsSoldContext,
} from '../types.js';
import { BotAppController } from './bot-app-controller.js';
import { botAppCSS } from './bot-app-css.js';
import { sharedCSS } from './shared-css.js';

@customElement('bot-app')
export class BotAppView extends LitElement {
    private readonly controller = new BotAppController(this);

    @state()
    embedded = false;

    @state()
    app?: App;

    @state()
    appState = BotAppState.LOADING;

    @state()
    inventoryBook?: Book;

    @state()
    error?: AppError;

    @state()
    initialDate = '';

    @state()
    cogsContext?: CostOfGoodsSoldContext;

    @state()
    hasViewerPermission = false;

    @state()
    hasEditorPermission = false;

    @state()
    validating = false;

    @state()
    validationError = '';

    static styles = [sharedCSS, botAppCSS];

    render(): TemplateResult {
        return html`
            ${this.renderHeader()}
            <div class="body" @execution-changed=${this.handleExecutionChange}>
                ${this.renderBodyContent()}
            </div>
        `;
    }

    private renderHeader(): TemplateResult {
        if (this.embedded || !this.app) {
            return html``;
        }
        return html`<app-header .app=${this.app} .book=${this.inventoryBook}></app-header>`;
    }

    private renderBodyContent(): TemplateResult {
        if (this.appState === BotAppState.LOADING) {
            return html`<div class="centered"><wa-spinner></wa-spinner></div>`;
        }
        if (this.appState === BotAppState.ERROR) {
            return this.renderAppError();
        }
        if (this.inventoryBook && !this.hasViewerPermission) {
            return this.renderAppError();
        }
        if (this.inventoryBook) {
            const permissionError = this.hasEditorPermission ? undefined : this.error;
            return html`
                <cost-of-goods-sold
                    .context=${this.cogsContext}
                    .date=${this.initialDate}
                    .permissionError=${permissionError}
                ></cost-of-goods-sold>
            `;
        }
        return html``;
    }

    private renderAppError(): TemplateResult {
        return html`<app-error .error=${this.error}></app-error>`;
    }

    private handleExecutionChange(event: ExecutionChangeEvent): void {
        const appState = event.detail.executing ? BotAppState.EXECUTING : BotAppState.READY;
        if (appState !== this.appState) {
            this.appState = appState;
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
