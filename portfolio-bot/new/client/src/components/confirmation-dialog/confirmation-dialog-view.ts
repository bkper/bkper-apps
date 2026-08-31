import type WaDialog from '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { confirmationDialogCSS } from './confirmation-dialog-css.js';
import { sharedCSS } from '../shared-css.js';

@customElement('confirmation-dialog')
export class ConfirmationDialogView extends LitElement {
    @property()
    headerLabel = '';

    @property()
    message = '';

    @property()
    actionLabel = '';

    @property()
    confirmationPhrase = '';

    @state()
    private confirmationInput = '';

    @state()
    private confirmationDispatched = false;

    @query('wa-dialog')
    private dialog?: WaDialog;

    static styles = [sharedCSS, confirmationDialogCSS];

    show(): void {
        this.confirmationInput = '';
        this.confirmationDispatched = false;
        if (this.dialog) {
            this.dialog.open = true;
        }
    }

    hide(): void {
        if (this.dialog) {
            this.dialog.open = false;
        }
    }

    render(): TemplateResult {
        return html`
            <wa-dialog
                label=${this.headerLabel}
                light-dismiss
                @wa-after-hide=${this.handleDialogAfterHide}
            >
                <div class="content">
                    <p>${this.message}</p>
                    ${this.renderConfirmationInput()}
                </div>
                <wa-button
                    slot="footer"
                    appearance="outlined"
                    size="s"
                    type="button"
                    data-dialog="close"
                >
                    Cancel
                </wa-button>
                <wa-button
                    slot="footer"
                    variant=${this.confirmationPhrase ? 'danger' : 'brand'}
                    appearance="outlined"
                    size="s"
                    type="button"
                    ?disabled=${this.isActionDisabled()}
                    @click=${this.handleActionClicked}
                >
                    ${this.actionLabel}
                </wa-button>
            </wa-dialog>
        `;
    }

    private handleDialogAfterHide(): void {
        this.confirmationInput = '';
    }

    private renderConfirmationInput(): TemplateResult {
        if (!this.confirmationPhrase) {
            return html``;
        }
        const label = `Type "${this.confirmationPhrase}" to continue`;
        return html`
            <wa-input
                label=${label}
                .value=${this.confirmationInput}
                autocomplete="off"
                size="s"
                @input=${this.handleConfirmationInputted}
            ></wa-input>
        `;
    }

    private handleConfirmationInputted(event: Event): void {
        const input = event.currentTarget as WaInput;
        this.confirmationInput = input.value ?? '';
    }

    private isActionDisabled(): boolean {
        return (
            this.confirmationDispatched ||
            (this.confirmationPhrase !== '' &&
                this.confirmationInput.trim() !== this.confirmationPhrase)
        );
    }

    private handleActionClicked(): void {
        if (this.isActionDisabled()) {
            return;
        }
        this.confirmationDispatched = true;
        this.hide();
        this.dispatchEvent(
            new CustomEvent('confirmed', {
                bubbles: true,
                composed: true,
            })
        );
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'confirmation-dialog': ConfirmationDialogView;
    }
}
