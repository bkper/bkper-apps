import type { Account, Group } from 'bkper-js';
import { LitElement, type TemplateResult, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { accountListCSS } from './account-list-css.js';
import { sharedCSS } from '../shared-css.js';

@customElement('account-list')
export class AccountListView extends LitElement {
    @property({ attribute: false })
    accounts: Account[] = [];

    @property({ attribute: false })
    selectedAccount?: Account;

    @property({ attribute: false })
    selectedGroup?: Group;

    static styles = [sharedCSS, accountListCSS];

    render(): TemplateResult {
        return html`
            <h3>${this.getTitle()}</h3>
            ${this.renderAccounts()}
        `;
    }

    private getTitle(): string {
        if (this.selectedAccount) {
            return 'Selected account:';
        }
        if (this.selectedGroup) {
            const name = this.selectedGroup.getName() ?? this.selectedGroup.getId() ?? 'Unknown';
            return `Accounts from selected group: ${name}`;
        }
        return 'Uncalculated accounts:';
    }

    private renderAccounts(): TemplateResult {
        if (this.accounts.length === 0) {
            return html`<div class="account" role="status">No eligible accounts found.</div>`;
        }
        return html`
            <div class="accounts" role="list">
                ${this.accounts.map(account => this.renderAccount(account))}
            </div>
        `;
    }

    private renderAccount(account: Account): TemplateResult {
        const name = account.getName() ?? account.getId() ?? '';
        return html`
            <div class="account" role="listitem">
                ${this.renderAccountType(account)}
                <span>${name}</span>
            </div>
        `;
    }

    private renderAccountType(account: Account): TemplateResult {
        const typeClass = account.getType()?.toLowerCase();
        if (!typeClass) {
            return html``;
        }
        return html`<span class="account-type ${typeClass}" aria-hidden="true"></span>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'account-list': AccountListView;
    }
}
