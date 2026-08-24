import type { Account, App, Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-header/app-header-view.js';
import './app-error/app-error-view.js';
import type { AppError, RealizedResultsContext } from '../types.js';
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
    error?: AppError;

    @state()
    initialDate = '';

    @state()
    realizedResultsContext?: RealizedResultsContext;

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
            return this.renderRealizedResults();
        }
        return html``;
    }

    private renderRealizedResults(): TemplateResult {
        return html`
            <div class="realized-results">
                <div class="intro">
                    <h2>Realized Results</h2>
                    <p>Review the accounts below before running an operation.</p>
                </div>
                <div class="accounts-container">
                    ${this.renderAccountsTitle()} ${this.renderAccounts()}
                </div>
            </div>
        `;
    }

    private renderAccountsTitle(): TemplateResult {
        const context = this.realizedResultsContext;
        const group = context?.selectedGroup;
        const account = context?.selectedAccount;

        let title = '';

        if (account) {
            title = `Selected account:`;
        } else if (group) {
            const groupName = group.getName() ?? group.getId() ?? 'Unknown';
            title = `Accounts from selected group: ${groupName}`;
        } else {
            title = `Uncalculated accounts:`;
        }

        return html`<h3>${title}</h3>`;
    }

    private renderAccounts(): TemplateResult {
        const accounts = this.realizedResultsContext?.accounts ?? [];
        if (accounts.length === 0) {
            return html`<div class="account" role="status">No eligible accounts found.</div>`;
        }
        return html`
            <div class="accounts" role="list">
                ${accounts.map(account => this.renderAccount(account))}
            </div>
        `;
    }

    private renderAccount(account: Account): TemplateResult {
        const name = account.getName() ?? account.getId() ?? '';
        return html`
            <div class="account" role="listitem">
                ${this.renderAccountType(account)}
                <span>${name}</span>
            </div>
        `;
    }

    private renderAccountType(account: Account): TemplateResult {
        const typeClass = account.getType()?.toLowerCase();
        if (!typeClass) {
            return html``;
        }
        return html`<span class="account-type ${typeClass}" aria-hidden="true"></span>`;
    }

    private renderAppError(): TemplateResult {
        return html`<app-error .error=${this.error}></app-error>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bot-app': BotAppView;
    }
}
