import { LitElement, TemplateResult, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { appHeaderCSS } from './app-header-css.js';

@customElement('app-header')
export class AppHeaderView extends LitElement {
    static styles = appHeaderCSS;

    render(): TemplateResult {
        return html`
            <wa-card appearance="outlined">
                <h1 class="title">Exchange Bot</h1>
                <p class="subtitle">Cloudflare migration shell</p>
            </wa-card>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'app-header': AppHeaderView;
    }
}
