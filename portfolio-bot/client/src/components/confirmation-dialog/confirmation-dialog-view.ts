import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type WaDialog from '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { confirmationDialogCSS } from './confirmation-dialog-css.js';
import { sharedCSS } from '../shared-css.js';

export interface ConfirmationDialogOptions {
    headerLabel: string;
    message: string;
    actionLabel: string;
    confirmationLabel?: string;
}

@customElement('confirmation-dialog')
export class ConfirmationDialogView extends LitElement {
    @state()
    private headerLabel = '';

    @state()
    private message = '';

    @state()
    private actionLabel = '';

    @state()
    private confirmationLabel = '';

    @state()
    private confirmationChecked = false;

    @state()
    private confirmationDispatched = false;

    @query('wa-dialog')
    private dialog?: WaDialog;

    static styles = [sharedCSS, confirmationDialogCSS];

    show(options: ConfirmationDialogOptions): void {
        this.headerLabel = options.headerLabel;
        this.message = options.message;
        this.actionLabel = options.actionLabel;
        this.confirmationLabel = options.confirmationLabel ?? '';
        this.confirmationChecked = false;
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
                    ${this.renderConfirmationCheckbox()}
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
                    variant=${this.confirmationLabel ? 'danger' : 'brand'}
                    appearance=${this.confirmationLabel ? 'outlined' : 'accent'}
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
        this.confirmationChecked = false;
    }

    private renderConfirmationCheckbox(): TemplateResult {
        if (!this.confirmationLabel) {
            return html``;
        }
        return html`
            <wa-checkbox
                .checked=${this.confirmationChecked}
                size="s"
                @change=${this.handleConfirmationChanged}
            >
                ${this.confirmationLabel}
            </wa-checkbox>
        `;
    }

    private handleConfirmationChanged(event: Event): void {
        const checkbox = event.currentTarget as WaCheckbox;
        this.confirmationChecked = checkbox.checked;
    }

    private isActionDisabled(): boolean {
        return (
            this.confirmationDispatched ||
            (this.confirmationLabel !== '' && !this.confirmationChecked)
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
