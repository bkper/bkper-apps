import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AppError } from '../../types.js';
import { sharedCSS } from '../shared-css.js';
import { appErrorCSS } from './app-error-css.js';

@customElement('app-error')
export class AppErrorView extends LitElement {
    @property({ attribute: false })
    error?: AppError;

    static styles = [sharedCSS, appErrorCSS];

    render(): TemplateResult {
        if (!this.error) {
            return html``;
        }
        const { title, message } = this.error;
        return html`
            <div class="container" role="alert">
                ${this.renderTitle(title)}
                <p>${this.renderMessage(message)}</p>
            </div>
        `;
    }

    private renderTitle(title: AppError['title']): TemplateResult {
        if (!title) {
            return html``;
        }
        return html`<h2>${title}</h2>`;
    }

    private renderMessage(message: AppError['message']): TemplateResult {
        return html`${message.before} ${this.renderAction(message.action)} ${message.after}`;
    }

    private renderAction(action: AppError['message']['action']): TemplateResult {
        if (!action) {
            return html``;
        }
        return html`
            <a href=${action.url} target="_blank" rel="noopener noreferrer">${action.label}</a>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'app-error': AppErrorView;
    }
}
