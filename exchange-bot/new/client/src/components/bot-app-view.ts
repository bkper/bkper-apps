import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import './app-error/app-error-view.js';
import { appEnv } from '../app-env.js';
import { Errors } from '../errors.js';
import type { AppError, ExchangeBotBook } from '../types.js';
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
    bookId = '';

    @state()
    book?: Book;

    @state()
    error = '';

    @state()
    initialDate = '';

    @state()
    books: ExchangeBotBook[] = [];

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
            return this.renderAppError();
        }
        if (this.book && !this.hasViewerPermission) {
            return this.renderAppError();
        }
        if (this.book) {
            return html`
                <exchange-update
                    .book=${this.book}
                    .books=${this.books}
                    .date=${this.initialDate}
                    .hasPermission=${this.hasEditorPermission}
                    .error=${this.error}
                ></exchange-update>
                ${this.renderValidations()} ${this.renderWarnings()}
            `;
        }
        return html``;
    }

    private renderAppError(): TemplateResult {
        let appError: AppError | undefined;

        if (this.error) {
            appError = { message: { before: this.error } };
        }

        if (this.bookId && !this.book && this.error === Errors.BOOK_ACCESS_REQUIRED) {
            appError = {
                title: this.error,
                message: {
                    action: {
                        label: 'Request access',
                        url: appEnv.getBookUrl(this.bookId),
                    },
                    after: 'in Bkper to continue.',
                },
            };
        }

        return html`<app-error .error=${appError}></app-error>`;
    }

    private renderValidations(): TemplateResult {
        if (this.validationError) {
            return html`
                <div class="validation-error" role="alert">
                    <span>
                        ${this.validationError}
                        <button
                            class="validation-retry focusable"
                            @click=${this.handleValidationRetry}
                        >
                            Retry
                        </button>
                    </span>
                </div>
            `;
        }
        if (this.validating) {
            return html`
                <div class="validations" role="status">
                    <div class="validations-title">
                        <wa-spinner></wa-spinner>
                        <span>Validating connected Books...</span>
                    </div>
                </div>
            `;
        }
        return html``;
    }

    private renderWarnings(): TemplateResult {
        if (this.warnings.length === 0) {
            return html``;
        }
        return html`
            <div class="warnings">
                <div class="warnings-title">
                    <wa-icon name="warning" label="Warnings"></wa-icon>
                    <span>Warnings</span>
                </div>
                <div class="warnings-list">
                    ${this.warnings.map(w => html`<div class="warning" role="status">${w}</div>`)}
                </div>
            </div>
        `;
    }

    private handleValidationRetry(): void {
        this.controller.retryValidations();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
