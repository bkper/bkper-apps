import { describe, expect, it } from 'bun:test';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { ForwardDateView } from '../../../src/components/forward-date/forward-date-view.js';
import type { AppError, ForwardDateContext } from '../../../src/types.js';

const render = Reflect.get(ForwardDateView.prototype, 'render') as (
    this: ForwardDateView
) => TemplateResult;
const renderPermissionError = Reflect.get(ForwardDateView.prototype, 'renderPermissionError') as (
    this: ForwardDateView
) => TemplateResult;

describe('Forward Date view', () => {
    it('renders its feature shell and delegates the Account scope', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const accounts = [new Account(portfolioBook, { id: 'apple', name: 'Apple' })];
        const selectedAccount = accounts[0];
        const selectedGroup = new Group(portfolioBook, {
            id: 'technology',
            name: 'Technology',
        });
        const context: ForwardDateContext = {
            portfolioBook,
            accounts,
            selectedAccount,
            selectedGroup,
        };
        const view = new ForwardDateView();
        view.context = context;

        const result = render.call(view);

        expect(result.strings.join('')).toContain('<service-intro');
        expect(result.strings.join('')).toContain('<account-list');
        expect(result.values[0]).toBe(context.accounts);
        expect(result.values[1]).toBe(context.selectedAccount);
        expect(result.values[2]).toBe(context.selectedGroup);
    });

    it('renders the supplied permission error without hiding the Account scope', () => {
        const view = new ForwardDateView();
        const permissionError: AppError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        view.permissionError = permissionError;

        const result = render.call(view);
        const errorResult = renderPermissionError.call(view);

        expect(result.strings.join('')).toContain('<account-list');
        expect(errorResult.strings.join('')).toContain('<app-error');
        expect(errorResult.values[0]).toBe(permissionError);
    });

    it('does not render a permission error when none is supplied', () => {
        const result = renderPermissionError.call(new ForwardDateView());

        expect(result.strings.join('')).toBe('');
    });
});
