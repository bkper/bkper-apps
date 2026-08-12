import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appEnv } from '../../app-env.js';
import { APP_LOGO_URL_DARK, APP_LOGO_URL_LIGHT } from '../../constants.js';
import '../app-help/app-help-view.js';
import { AppHeaderController } from './app-header-controller.js';
import { appHeaderCSS } from './app-header-css.js';
import { sharedCSS } from '../shared-css.js';

@customElement('app-header')
export class AppHeaderView extends LitElement {
    private readonly controller = new AppHeaderController(this);

    @property({ attribute: false })
    book?: Book;

    static styles = [sharedCSS, appHeaderCSS];

    render(): TemplateResult {
        return html`
            <header class="container">
                <div class="app">
                    <img class="app-logo" src=${this.getAppLogoUrl()} alt="Exchange Bot" />
                    <h1 class="app-title hide-on-phone">Exchange Bot</h1>
                </div>
                ${this.renderBookName()}
                <app-help></app-help>
            </header>
        `;
    }

    private renderBookName(): TemplateResult {
        if (!this.book) {
            return html``;
        }
        const bookId = this.book.getId();
        const bookName = this.book.getName() ?? bookId;
        const bookUrl = appEnv.getBookUrl(bookId);
        return html`
            <div class="book">
                <h2 class="book-name">${bookName}</h2>
                <wa-tooltip for="open-book" placement="right">Open</wa-tooltip>
                <a
                    id="open-book"
                    class="book-link focusable"
                    href=${bookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <wa-icon name="open_in_new" label="Open"></wa-icon>
                </a>
            </div>
        `;
    }

    private getAppLogoUrl(): string {
        return this.controller.isDark ? APP_LOGO_URL_DARK : APP_LOGO_URL_LIGHT;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'app-header': AppHeaderView;
    }
}
