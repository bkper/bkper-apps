import { describe, expect, it } from 'bun:test';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { RealizedResultsView } from '../../../src/components/realized-results/realized-results-view.js';
import type { AppError, RealizedResultsContext } from '../../../src/types.js';

const render = Reflect.get(RealizedResultsView.prototype, 'render') as (
    this: RealizedResultsView
) => TemplateResult;
const renderPermissionError = Reflect.get(
    RealizedResultsView.prototype,
    'renderPermissionError'
) as (this: RealizedResultsView) => TemplateResult;

function createContext(): RealizedResultsContext {
    const portfolioBook = new Book({ id: 'portfolio-book', name: 'Portfolio Book' });
    return {
        portfolioBook,
        selectedGroup: new Group(portfolioBook, {
            id: 'technology',
            name: 'Technology',
        }),
        accounts: [
            new Account(portfolioBook, { id: 'alphabet', name: 'Alphabet' }),
            new Account(portfolioBook, { id: 'apple', name: 'Apple' }),
        ],
        financialBooks: [],
        resetEnabled: true,
        fullResetEnabled: false,
    };
}

describe('Realized results view', () => {
    it('renders the current introduction and delegates the Account scope', () => {
        const view = new RealizedResultsView();
        const context = createContext();
        view.context = context;

        const result = render.call(view);

        expect(result.strings.join('')).toContain('Realized Results');
        expect(result.strings.join('')).toContain('<account-list');
        expect(result.values[0]).toBe(context.accounts);
        expect(result.values[1]).toBeUndefined();
        expect(result.values[2]).toBe(context.selectedGroup);
    });

    it('renders the supplied permission error without hiding the Account scope', () => {
        const view = new RealizedResultsView();
        const permissionError: AppError = {
            type: 'error',
            message: { before: 'User needs EDITOR or OWNER permission in BRL books' },
        };
        view.context = createContext();
        view.permissionError = permissionError;

        const result = render.call(view);
        const errorResult = renderPermissionError.call(view);

        expect(result.strings.join('')).toContain('<account-list');
        expect(errorResult.strings.join('')).toContain('<app-error');
        expect(errorResult.values[0]).toBe(permissionError);
    });

    it('does not render a permission error when none is supplied', () => {
        const result = renderPermissionError.call(new RealizedResultsView());

        expect(result.strings.join('')).toBe('');
    });
});
