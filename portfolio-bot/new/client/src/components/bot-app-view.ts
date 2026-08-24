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
        let title = '';
        if (this.group) {
            const groupName = this.group.getName() ?? this.group.getId() ?? 'Unknown';
            title = `Selected group: ${groupName}`;
        } else if (this.accounts.length === 1) {
            const account = this.accounts[0];
            const accountName = account.getName() ?? account.getId() ?? 'Unknown';
            title = `Selected account: ${accountName}`;
        } else {
            title = `Showing uncalculated accounts:`;
        }
        return html`<h3>${title}</h3>`;
    }

    private renderAccounts(): TemplateResult {
        const accounts = this.accounts;
        if (accounts.length === 0) {
            return html`<div class="account" role="status">No eligible accounts found.</div>`;
        }
        return html`
            <div class="accounts" role="list">
                ${this.accounts.map(account => {
                    const name = account.getName() ?? account.getId() ?? '';
                    return html`<div class="account" role="listitem">${name}</div>`;
                })}
            </div>
        `;
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
