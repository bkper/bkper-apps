import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { APP_LOGO_URL_DARK, APP_LOGO_URL_LIGHT } from '../../constants.js';
import { AppHeaderController } from './app-header-controller.js';
import { appHeaderCSS } from './app-header-css.js';

@customElement('app-header')
export class AppHeaderView extends LitElement {
    private readonly controller = new AppHeaderController(this);

    @property({ attribute: false })
    book?: Book;

    static styles = appHeaderCSS;

    render(): TemplateResult {
        return html`
            <header class="container">
                <div class="app">
                    <img class="app-logo" src=${this.getAppLogoUrl()} alt="Exchange Bot" />
                    <h1 class="app-title">Exchange Bot</h1>
                </div>
                <h2 class="book-name">${this.book?.getName()}</h2>
            </header>
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
