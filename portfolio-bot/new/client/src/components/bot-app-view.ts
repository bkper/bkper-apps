import type { App, Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import './app-error/app-error-view.js';
import './forward-date/forward-date-view.js';
import './realized-results/realized-results-view.js';
import {
    BotAppState,
    PortfolioService,
    type AppError,
    type ExecutionChangeEvent,
    type ForwardDateContext,
    type RealizedResultsContext,
    type ServiceChangeEvent,
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
    portfolioBook?: Book;

    @state()
    error?: AppError;

    @state()
    initialDate = '';

    @state()
    realizedResultsContext?: RealizedResultsContext;

    @state()
    forwardDateContext?: ForwardDateContext;

    @state()
    activeService = PortfolioService.REALIZED_RESULTS;

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
        return html`<app-header .app=${this.app} .book=${this.portfolioBook}></app-header>`;
    }

    private renderBodyContent(): TemplateResult {
        if (this.appState === BotAppState.LOADING) {
            return html`<div class="centered"><wa-spinner></wa-spinner></div>`;
        }
        if (this.appState === BotAppState.ERROR) {
            return this.renderAppError();
        }
        if (this.portfolioBook && !this.hasViewerPermission) {
            return this.renderAppError();
        }
        if (this.portfolioBook) {
            const permissionError = this.hasEditorPermission ? undefined : this.error;
            return html`
                <realized-results
                    .context=${this.realizedResultsContext}
                    .date=${this.initialDate}
                    .permissionError=${permissionError}
                    ?hidden=${this.activeService !== PortfolioService.REALIZED_RESULTS}
                    @service-change=${this.handleServiceChange}
                ></realized-results>
                <forward-date
                    .context=${this.forwardDateContext}
                    .date=${this.initialDate}
                    .permissionError=${permissionError}
                    ?hidden=${this.activeService !== PortfolioService.FORWARD_DATE}
                    @service-change=${this.handleServiceChange}
                ></forward-date>
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

    private handleServiceChange(event: ServiceChangeEvent): void {
        const service = event.detail.service;
        if (service !== this.activeService) {
            this.activeService = service;
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
