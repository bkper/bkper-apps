import type WaDropdownItem from '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/events.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PortfolioService, type ServiceChangeDetail } from '../../types.js';
import { sharedCSS } from '../shared-css.js';
import { serviceSwitcherCSS } from './service-switcher-css.js';

interface ServiceOption {
    value: PortfolioService;
    label: string;
}

const SERVICE_OPTIONS: readonly ServiceOption[] = [
    { value: PortfolioService.REALIZED_RESULTS, label: 'Realized Results' },
    { value: PortfolioService.FORWARD_DATE, label: 'Forward Date' },
];

@customElement('service-switcher')
export class ServiceSwitcherView extends LitElement {
    @property({ attribute: false })
    service: PortfolioService = PortfolioService.REALIZED_RESULTS;

    @property()
    instructions = '';

    @property({ type: Boolean })
    showMenu = true;

    static styles = [sharedCSS, serviceSwitcherCSS];

    render(): TemplateResult {
        const heading = SERVICE_OPTIONS.find(option => option.value === this.service)?.label ?? '';
        return html`
            <div class="heading">
                <h2>${heading}</h2>
                ${this.renderDropdown()}
            </div>
            <p>${this.instructions}</p>
        `;
    }

    private renderDropdown(): TemplateResult {
        if (!this.showMenu) {
            return html``;
        }
        return html`
            <wa-dropdown placement="bottom-start" @wa-select=${this.handleSelect}>
                <wa-button
                    class="trigger"
                    slot="trigger"
                    variant="neutral"
                    appearance="plain"
                    size="s"
                >
                    <wa-icon name="keyboard_arrow_down" label="Switch service"></wa-icon>
                </wa-button>
                ${SERVICE_OPTIONS.map(
                    option => html`
                        <wa-dropdown-item
                            class=${option.value === this.service ? 'selected' : ''}
                            value=${option.value}
                        >
                            ${option.label}
                        </wa-dropdown-item>
                    `
                )}
            </wa-dropdown>
        `;
    }

    private handleSelect(event: WaSelectEvent): void {
        const item = event.detail.item as WaDropdownItem;
        const service = SERVICE_OPTIONS.find(option => option.value === item.value)?.value;
        if (!service || service === this.service) {
            return;
        }
        this.dispatchEvent(
            new CustomEvent<ServiceChangeDetail>('service-change', {
                detail: { service },
                bubbles: true,
                composed: true,
            })
        );
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'service-switcher': ServiceSwitcherView;
    }
}
