import { describe, expect, it } from 'bun:test';
import { Account, AccountType, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { AccountListView } from '../../../src/components/account-list/account-list-view.js';

const render = Reflect.get(AccountListView.prototype, 'render') as (
    this: AccountListView
) => TemplateResult;

function collectRenderedText(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap(collectRenderedText);
    }
    if (value && typeof value === 'object' && 'values' in value && 'strings' in value) {
        const result = value as TemplateResult;
        return [...result.strings, ...collectRenderedText(result.values)];
    }
    return [];
}

describe('Account list view', () => {
    it('renders the selected Account scope and Account rows', () => {
        const book = new Book({ id: 'portfolio-book' });
        const selectedAccount = new Account(book, {
            id: 'apple',
            name: 'Apple',
            type: AccountType.ASSET,
        });
        const view = new AccountListView();
        view.accounts = [selectedAccount];
        view.selectedAccount = selectedAccount;
        view.selectedGroup = new Group(book, { id: 'technology', name: 'Technology' });

        const result = render.call(view);
        const renderedText = collectRenderedText(result);

        expect(renderedText).toContain('Selected account:');
        expect(renderedText).not.toContain('Technology');
        expect(renderedText).toContain('Apple');
        expect(renderedText).toContain('asset');
    });

    it('maps Account types to their canonical indicator classes', () => {
        const book = new Book({ id: 'portfolio-book' });
        const view = new AccountListView();
        view.accounts = [
            new Account(book, { name: 'Asset', type: AccountType.ASSET }),
            new Account(book, { name: 'Liability', type: AccountType.LIABILITY }),
            new Account(book, { name: 'Incoming', type: AccountType.INCOMING }),
            new Account(book, { name: 'Outgoing', type: AccountType.OUTGOING }),
        ];

        const renderedText = collectRenderedText(render.call(view));

        expect(renderedText).toContain('asset');
        expect(renderedText).toContain('liability');
        expect(renderedText).toContain('incoming');
        expect(renderedText).toContain('outgoing');
    });

    it('renders the selected Group scope and its Account rows', () => {
        const book = new Book({ id: 'portfolio-book' });
        const view = new AccountListView();
        view.accounts = [
            new Account(book, { id: 'alphabet', name: 'Alphabet' }),
            new Account(book, { id: 'apple', name: 'Apple' }),
        ];
        view.selectedGroup = new Group(book, { id: 'technology', name: 'Technology' });

        const renderedText = collectRenderedText(render.call(view));

        expect(renderedText).toContain('Accounts from selected group: Technology');
        expect(renderedText).toContain('Alphabet');
        expect(renderedText).toContain('Apple');
    });

    it('renders the pending-calculation scope and an explicit empty state', () => {
        const renderedText = collectRenderedText(render.call(new AccountListView()));

        expect(renderedText).toContain('Uncalculated accounts:');
        expect(renderedText.join('')).toContain('No eligible accounts found.');
    });
});
