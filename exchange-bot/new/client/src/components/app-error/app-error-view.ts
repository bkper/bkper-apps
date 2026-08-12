import type { Book } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appEnv } from '../../app-env.js';
import { sharedCSS } from '../shared-css.js';
import { appErrorCSS } from './app-error-css.js';

@customElement('app-error')
export class AppErrorView extends LitElement {
    @property()
    bookId = '';

    @property({ attribute: false })
    book?: Book;

    @property()
    error = '';

    @property()
    permissionError = '';

    static styles = [sharedCSS, appErrorCSS];

    render(): TemplateResult {
        if (this.bookId && !this.book && this.permissionError) {
            return this.renderAccessRequired();
        }
        const message = this.permissionError || this.error;
        if (!message) {
            return html``;
        }
        return html`<div class="error" role="alert">${message}</div>`;
    }

    private renderAccessRequired(): TemplateResult {
        const bookUrl = appEnv.getBookUrl(this.bookId);
        return html`
            <div class="access-required">
                <h2>${this.permissionError}</h2>
                <p>
                    <a href=${bookUrl} target="_blank" rel="noopener noreferrer">Request access</a>
                    in Bkper to continue.
                </p>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'app-error': AppErrorView;
    }
}
