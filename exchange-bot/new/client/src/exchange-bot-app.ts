import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { authService } from './services/auth-service.js';

@customElement('exchange-bot-app')
export class ExchangeBotApp extends LitElement {
    static styles = css`
        :host {
            display: block;
            padding: var(--bkper-spacing-large);
        }

        h1,
        p {
            margin: 0;
        }

        p {
            margin-top: var(--bkper-spacing-small);
            color: var(--bkper-color-neutral);
        }
    `;

    protected firstUpdated(): void {
        void authService.init();
    }

    render() {
        return html`
            <wa-card appearance="outlined">
                <h1>Exchange Bot</h1>
                <p>Cloudflare migration shell</p>
            </wa-card>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'exchange-bot-app': ExchangeBotApp;
    }
}
