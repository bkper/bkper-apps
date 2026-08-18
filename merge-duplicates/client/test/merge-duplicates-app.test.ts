import { describe, expect, it } from 'bun:test';
import { render, type TemplateResult } from 'lit';
import type { Suggestion, TransactionFingerprint } from '../src/api/app-api';
import { MergeDuplicatesApp } from '../src/components/merge-duplicates-app';

const renderHeader = Reflect.get(MergeDuplicatesApp.prototype, 'renderHeader') as (
    this: MergeDuplicatesApp
) => TemplateResult;
const renderAccount = Reflect.get(MergeDuplicatesApp.prototype, 'renderAccount') as (
    this: MergeDuplicatesApp,
    account: TransactionFingerprint['fromAccount']
) => TemplateResult;
const renderTransaction = Reflect.get(MergeDuplicatesApp.prototype, 'renderTransaction') as (
    this: MergeDuplicatesApp,
    transaction: TransactionFingerprint
) => TemplateResult;

function templateText(result: TemplateResult): string {
    return [
        ...result.strings,
        ...result.values.flatMap(value =>
            value && typeof value === 'object' && 'strings' in value
                ? templateText(value as TemplateResult)
                : String(value ?? '')
        ),
    ].join('');
}

function suggestion(): Suggestion {
    const snapshot = (id: string) => ({
        id,
        date: '2026-06-10',
        amount: '10',
        description: id,
        fromAccount: { id: 'bank', name: 'Bank' },
        toAccount: { id, name: id },
        properties: {},
        draft: false,
    });
    return {
        id: 'pair',
        strength: 'Strong',
        explanation: 'Likely duplicate',
        first: snapshot('first'),
        second: snapshot('second'),
    };
}

describe('merge duplicates app', () => {
    it('hides its redundant branding when embedded in the Bkper sidebar', () => {
        const app = new MergeDuplicatesApp() as MergeDuplicatesApp & { embedded: boolean };
        app.embedded = true;
        app.controller.state.context.query = "account:'Client A'";

        const text = templateText(renderHeader.call(app));

        expect(text).not.toContain('Merge Duplicates logo');
        expect(text).toContain("account:'Client A'");
    });

    it('keeps its branding when opened standalone', () => {
        const app = new MergeDuplicatesApp() as MergeDuplicatesApp & { embedded: boolean };
        app.embedded = false;

        expect(templateText(renderHeader.call(app))).toContain('Merge Duplicates logo');
    });

    it('allows confirmation when every suggestion is rejected', () => {
        const app = new MergeDuplicatesApp();

        app.controller.showConfirmation();
        expect(app.controller.state.confirmOpen).toBe(false);

        app.controller.review.suggestions = [suggestion()];
        app.controller.showConfirmation();
        expect(app.controller.state.confirmOpen).toBe(true);
    });

    it('renders a missing account as a compact accessible placeholder', () => {
        const text = templateText(renderAccount.call(new MergeDuplicatesApp(), undefined));

        expect(text).toContain('role="img"');
        expect(text).toContain('aria-label="Unassigned account"');
        expect(text).toMatch(/>—<\/span\s*>/);
    });

    it('groups transaction identity details in the PWA reading order', () => {
        const transaction = suggestion().first;
        const container = document.createElement('div');

        render(renderTransaction.call(new MergeDuplicatesApp(), transaction), container);

        const content = container.querySelector('.transaction-content');
        const summary = content?.querySelector('.transaction-summary');
        const accountFlow = content?.querySelector('.account-flow');
        expect(Array.from(summary?.children ?? []).map(element => element.className)).toEqual([
            'transaction-date',
            'amount',
        ]);
        expect(accountFlow?.querySelectorAll('.account-pill')).toHaveLength(2);
        expect(accountFlow?.querySelector('.movement-arrow')).not.toBeNull();
        expect(Array.from(content?.children ?? []).map(element => element.className)).toEqual([
            'transaction-summary',
            'account-flow',
            'description',
        ]);
    });

    it('wraps transaction blocks without splitting the date from amount or the account flow', () => {
        const styles = MergeDuplicatesApp.styles.cssText;

        expect(styles).toContain('container-type: inline-size');
        expect(styles).toMatch(/\.transaction-content\s*{[^}]+flex-wrap:\s*wrap;/s);
        expect(styles).toMatch(
            /\.transaction-summary,\s*\.account-flow\s*{[^}]+white-space:\s*nowrap;/s
        );
    });

    it('keeps the match strength and explanation inline when space allows', () => {
        const styles = MergeDuplicatesApp.styles.cssText;

        expect(styles).toMatch(/\.pair-copy\s*{[^}]+display:\s*flex;[^}]+flex-wrap:\s*wrap;/s);
    });

    it('only shows the explanation separator in wide layouts', () => {
        const styles = MergeDuplicatesApp.styles.cssText;

        expect(styles).toMatch(/\.pair-separator\s*{[^}]+display:\s*none;[^}]+margin-inline-end:/s);
        expect(styles).toMatch(/@container[^}]+\.pair-separator\s*{[^}]+display:\s*inline;/s);
    });
});
