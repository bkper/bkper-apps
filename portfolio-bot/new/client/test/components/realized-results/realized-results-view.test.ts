import { describe, expect, it } from 'bun:test';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { RealizedResultsView } from '../../../src/components/realized-results/realized-results-view.js';
import {
    PortfolioService,
    type AppError,
    type RealizedResultsContext,
} from '../../../src/types.js';

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
        resetEnabled: true,
        fullResetEnabled: false,
    };
}

describe('Realized results view', () => {
    it('renders the current introduction and delegates the Account scope', () => {
        const view = new RealizedResultsView();
        const context = createContext();
        view.context = context;
        view.date = '2026-03-10';

        const result = render.call(view);
        const markup = result.strings.join('');

        expect(markup).toContain('<service-switcher');
        expect(markup).toContain('<account-list');
        expect(markup).toContain('<wa-input');
        expect(markup).toContain('type="date"');
        expect(markup).toContain('Reset');
        expect(markup).toContain('Calculate');
        expect(result.values[0]).toBe(PortfolioService.REALIZED_RESULTS);
        expect(result.values[1]).toBe(true);
        expect(result.values[2]).toBe(context.accounts);
        expect(result.values[3]).toBeUndefined();
        expect(result.values[4]).toBe(context.selectedGroup);
        expect(result.values).toContain('2026-03-10');
    });

    it('hides service switching without a usable selected context', () => {
        const pendingContext = createContext();
        pendingContext.selectedGroup = undefined;
        const emptyGroupContext = createContext();
        emptyGroupContext.accounts = [];

        const pendingView = new RealizedResultsView();
        pendingView.context = pendingContext;
        const emptyGroupView = new RealizedResultsView();
        emptyGroupView.context = emptyGroupContext;

        expect(render.call(pendingView).values[1]).toBe(false);
        expect(render.call(emptyGroupView).values[1]).toBe(false);
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
