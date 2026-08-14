import type WaDropdownItem from '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/events.js';
import type { App } from 'bkper-js';
import { LitElement, TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appHelpCSS } from './app-help-css.js';
import { sharedCSS } from '../shared-css.js';

@customElement('app-help')
export class AppHelpView extends LitElement {
    @property({ attribute: false })
    app!: App;

    static styles = [sharedCSS, appHelpCSS];

    render(): TemplateResult {
        return html`
            <wa-tooltip class="hide-on-phone" for="help-trigger" placement="left">Help</wa-tooltip>
            <wa-dropdown placement="bottom-end" @wa-select=${this.handleSelect}>
                <wa-button
                    id="help-trigger"
                    class="trigger"
                    slot="trigger"
                    variant="neutral"
                    appearance="plain"
                    size="s"
                >
                    <wa-icon name="help" label="Help"></wa-icon>
                </wa-button>
                <wa-dropdown-item value="website">
                    <wa-icon slot="icon" name="public"></wa-icon>
                    Website
                </wa-dropdown-item>
                <wa-dropdown-item value="repository">
                    <wa-icon slot="icon" name="code_xml"></wa-icon>
                    Repository
                </wa-dropdown-item>
            </wa-dropdown>
        `;
    }

    private handleSelect(event: WaSelectEvent): void {
        const item = event.detail.item as WaDropdownItem;
        let url: string | undefined;
        if (item.value === 'website') {
            url = this.app.getWebsiteUrl();
        } else if (item.value === 'repository') {
            url = this.app.getRepositoryUrl();
        }
        if (url) {
            globalThis.open(url, '_blank')?.focus();
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'app-help': AppHelpView;
    }
}
