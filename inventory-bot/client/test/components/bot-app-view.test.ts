import { describe, expect, it } from 'bun:test';
import { App, Book, Permission } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { BotAppView } from '../../src/components/bot-app-view.js';
import { BotAppState, type AppError } from '../../src/types.js';

const renderHeader = Reflect.get(BotAppView.prototype, 'renderHeader') as (
    this: BotAppView
) => TemplateResult;
const renderBodyContent = Reflect.get(BotAppView.prototype, 'renderBodyContent') as (
    this: BotAppView
) => TemplateResult;
const handleExecutionChange = Reflect.get(BotAppView.prototype, 'handleExecutionChange') as (
    this: BotAppView,
    event: CustomEvent<{ executing: boolean }>
) => void;

describe('Bot app view', () => {
    it('passes the App and selected Book to the app header', () => {
        const view = new BotAppView();
        const app = new App({ id: 'inventory-bot', name: 'Inventory Bot' });
        const book = new Book({ id: 'book-id', name: 'Inventory Book' });
        view.app = app;
        view.inventoryBook = book;

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
        view.app = new App({ id: 'inventory-bot' });

        const result = renderHeader.call(view);

        expect(result.strings.join('')).toBe('');
    });

    it('mirrors child execution state at the app boundary', () => {
        const view = new BotAppView();

        handleExecutionChange.call(
            view,
            new CustomEvent('execution-changed', { detail: { executing: true } })
        );

        expect(view.appState).toBe(BotAppState.EXECUTING);
        expect(view.render().strings.join('')).toContain('@execution-changed=');

        handleExecutionChange.call(
            view,
            new CustomEvent('execution-changed', { detail: { executing: false } })
        );

        expect(view.appState).toBe(BotAppState.READY);
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
        view.inventoryBook = new Book({ id: 'book-id', permission: Permission.RECORDER });
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

    it('delegates the resolved operation context to Cost of Goods Sold', () => {
        const view = new BotAppView();
        const inventoryBook = new Book({
            id: 'inventory-book',
            name: 'Inventory Book',
            permission: Permission.VIEWER,
        });
        const context = {
            inventoryBook,
            accounts: [],
            resetEnabled: true,
        };
        view.inventoryBook = inventoryBook;
        view.initialDate = '2026-03-10';
        view.cogsContext = context;
        view.hasViewerPermission = true;
        view.hasEditorPermission = true;
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<cost-of-goods-sold');
        expect(result.values).toContain(context);
        expect(result.values).toContain('2026-03-10');
    });

    it('renders an edit-permission error without hiding the ready context', () => {
        const view = new BotAppView();
        view.inventoryBook = new Book({ id: 'book-id', permission: Permission.VIEWER });
        view.hasViewerPermission = true;
        view.hasEditorPermission = false;
        view.error = {
            type: 'error',
            message: { before: 'User needs EDITOR or OWNER permission in BRL books' },
        };
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<cost-of-goods-sold');
        expect(result.values).toContain(view.error);
    });

    it('renders non-error content for a ready, viewable Book', () => {
        const view = new BotAppView();
        view.inventoryBook = new Book({ id: 'book-id', permission: Permission.VIEWER });
        view.hasViewerPermission = true;
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);
        const markup = result.strings.join('');

        expect(markup).not.toBe('');
        expect(markup).not.toContain('<app-error');
        expect(markup).not.toContain('<wa-spinner>');
    });
});
