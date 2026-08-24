import { describe, expect, it } from 'bun:test';
import { Account, AccountType, App, Book, Group, Permission } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { BotAppState } from '../../src/components/bot-app-controller.js';
import { BotAppView } from '../../src/components/bot-app-view.js';
import type { AppError } from '../../src/types.js';

const renderHeader = Reflect.get(BotAppView.prototype, 'renderHeader') as (
    this: BotAppView
) => TemplateResult;
const renderBodyContent = Reflect.get(BotAppView.prototype, 'renderBodyContent') as (
    this: BotAppView
) => TemplateResult;
const renderEditPermissionError = Reflect.get(
    BotAppView.prototype,
    'renderEditPermissionError'
) as (this: BotAppView) => TemplateResult;

function collectRenderedText(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap(collectRenderedText);
    }
    if (value && typeof value === 'object' && 'values' in value) {
        return collectRenderedText((value as TemplateResult).values);
    }
    return [];
}

describe('Bot app view', () => {
    it('passes the App and selected Book to the app header', () => {
        const view = new BotAppView();
        const app = new App({ id: 'stock-bot', name: 'Global Portfolio Bot' });
        const book = new Book({ id: 'book-id', name: 'Portfolio Book' });
        view.app = app;
        view.portfolioBook = book;

        const result = renderHeader.call(view);

        expect(result.values[0]).toBe(app);
        expect(result.values[1]).toBe(book);
    });

    it('does not render the app header before App metadata is loaded', () => {
        const result = renderHeader.call(new BotAppView());

        expect(result.strings.join('')).toBe('');
    });

    it('does not render the app header in embedded mode', () => {
        const view = new BotAppView();
        view.embedded = true;
        view.app = new App({ id: 'stock-bot' });

        const result = renderHeader.call(view);

        expect(result.strings.join('')).toBe('');
    });

    it('renders loading progress while the app initializes', () => {
        const view = new BotAppView();

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<wa-spinner>');
    });

    it('routes initialization failures to the app error view', () => {
        const view = new BotAppView();
        view.error = {
            type: 'info',
            title: 'The selected Book could not be loaded.',
            message: { before: 'Please try again.' },
        };
        view.appState = BotAppState.ERROR;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<app-error');
        expect(result.values[0] as AppError).toBe(view.error);
    });

    it('hides ready content when the selected Book is not viewable', () => {
        const view = new BotAppView();
        view.portfolioBook = new Book({ id: 'book-id', permission: Permission.RECORDER });
        view.error = {
            type: 'info',
            title: 'Insufficient Book permission.',
            message: { before: 'Viewer permission is required.' },
        };
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<app-error');
        expect(result.values[0] as AppError).toBe(view.error);
    });

    it('renders Group and Account context without repeating the header Book name', () => {
        const view = new BotAppView();
        const portfolioBook = new Book({
            id: 'portfolio-book',
            name: 'Portfolio Book',
            permission: Permission.VIEWER,
        });
        view.portfolioBook = portfolioBook;
        view.realizedResultsContext = {
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
        };
        view.hasViewerPermission = true;
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);
        const renderedText = collectRenderedText(result).join(' ');

        expect(renderedText).not.toContain('Portfolio Book');
        expect(renderedText).toContain('Technology');
        expect(renderedText).toContain('Alphabet');
        expect(renderedText).toContain('Apple');
    });

    it('maps Account types to their canonical indicator classes', () => {
        const view = new BotAppView();
        const portfolioBook = new Book({ id: 'portfolio-book', permission: Permission.VIEWER });
        view.portfolioBook = portfolioBook;
        view.realizedResultsContext = {
            portfolioBook,
            accounts: [
                new Account(portfolioBook, { name: 'Asset', type: AccountType.ASSET }),
                new Account(portfolioBook, { name: 'Liability', type: AccountType.LIABILITY }),
                new Account(portfolioBook, { name: 'Incoming', type: AccountType.INCOMING }),
                new Account(portfolioBook, { name: 'Outgoing', type: AccountType.OUTGOING }),
            ],
            financialBooks: [],
            resetEnabled: true,
        };
        view.hasViewerPermission = true;
        view.appState = BotAppState.READY;

        const renderedText = collectRenderedText(renderBodyContent.call(view));

        expect(renderedText).toContain('asset');
        expect(renderedText).toContain('liability');
        expect(renderedText).toContain('incoming');
        expect(renderedText).toContain('outgoing');
    });

    it('renders an edit-permission error without hiding the ready context', () => {
        const view = new BotAppView();
        view.portfolioBook = new Book({ id: 'book-id', permission: Permission.VIEWER });
        view.hasViewerPermission = true;
        view.hasEditorPermission = false;
        view.error = {
            type: 'error',
            message: { before: 'User needs EDITOR or OWNER permission in BRL books' },
        };
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);
        const permissionError = renderEditPermissionError.call(view);

        expect(permissionError.strings.join('')).toContain('<app-error');
        expect(permissionError.values[0]).toBe(view.error);
        expect(result.strings.join('')).toContain('Realized Results');
    });

    it('renders non-error content for a ready, viewable Book', () => {
        const view = new BotAppView();
        view.portfolioBook = new Book({ id: 'book-id', permission: Permission.VIEWER });
        view.hasViewerPermission = true;
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);
        const markup = result.strings.join('');

        expect(markup).not.toBe('');
        expect(markup).not.toContain('<app-error');
        expect(markup).not.toContain('<wa-spinner>');
    });
});
