import type { Account, App, Book, Group } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import './app-error/app-error-view.js';
import type { AppError, PortfolioBotBook } from '../types.js';
import { BotAppController, BotAppState } from './bot-app-controller.js';
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
    group?: Group;

    @state()
    accounts: Account[] = [];

    @state()
    enableReset = false;

    @state()
    error?: AppError;

    @state()
    initialDate = '';

    @state()
    books: PortfolioBotBook[] = [];

    @state()
    hasViewerPermission = false;

    @state()
    hasEditorPermission = false;

    @state()
    validating = false;

    @state()
    validationError = '';

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
            return html`<p>Portfolio Bot is ready</p>`;
        }
        return html``;
    }

    private renderAppError(): TemplateResult {
        return html`<app-error .error=${this.error}></app-error>`;
    }

    // private renderValidations(): TemplateResult {
    //     if (this.validationError) {
    //         return html`
    //             <div class="validation-error" role="alert">
    //                 <span>
    //                     ${this.validationError}
    //                     <button
    //                         class="validation-retry focusable"
    //                         @click=${this.handleValidationRetry}
    //                     >
    //                         Retry
    //                     </button>
    //                 </span>
    //             </div>
    //         `;
    //     }
    //     if (this.validating) {
    //         return html`
    //             <div class="validations" role="status">
    //                 <div class="validations-title">
    //                     <wa-spinner></wa-spinner>
    //                     <span>Validating connected Books...</span>
    //                 </div>
    //             </div>
    //         `;
    //     }
    //     return html``;
    // }

    // private renderWarnings(): TemplateResult {
    //     if (this.warnings.length === 0) {
    //         return html``;
    //     }
    //     return html`
    //         <div class="warnings">
    //             <div class="warnings-title">
    //                 <wa-icon name="warning" label="Warnings"></wa-icon>
    //                 <span>Warnings</span>
    //             </div>
    //             <div class="warnings-list">
    //                 ${this.warnings.map(w => html`<div class="warning" role="status">${w}</div>`)}
    //             </div>
    //         </div>
    //     `;
    // }

    // private handleValidationRetry(): void {
    //     this.controller.retryValidations();
    // }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
