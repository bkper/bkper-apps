import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedCSS } from '../shared-css.js';
import { serviceIntroCSS } from './service-intro-css.js';

@customElement('service-intro')
export class ServiceIntroView extends LitElement {
    @property()
    heading = '';

    @property()
    instructions = '';

    static styles = [sharedCSS, serviceIntroCSS];

    render(): TemplateResult {
        return html`
            <h2>${this.heading}</h2>
            <p>${this.instructions}</p>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'service-intro': ServiceIntroView;
    }
}
