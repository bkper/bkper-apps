import { describe, expect, it } from 'bun:test';
import { App, Book, Permission } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { BotAppView } from '../../src/components/bot-app-view.js';
import {
    BotAppState,
    PortfolioService,
    type AppError,
    type ServiceChangeEvent,
} from '../../src/types.js';

const renderHeader = Reflect.get(BotAppView.prototype, 'renderHeader') as (
    this: BotAppView
) => TemplateResult;
const renderBodyContent = Reflect.get(BotAppView.prototype, 'renderBodyContent') as (
    this: BotAppView
) => TemplateResult;
const handleServiceChange = Reflect.get(BotAppView.prototype, 'handleServiceChange') as (
    this: BotAppView,
    event: ServiceChangeEvent
) => void;
const handleExecutionChange = Reflect.get(BotAppView.prototype, 'handleExecutionChange') as (
    this: BotAppView,
    event: CustomEvent<{ executing: boolean }>
) => void;

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

    it('delegates the resolved operation context to Realized Results', () => {
        const view = new BotAppView();
        const portfolioBook = new Book({
            id: 'portfolio-book',
            name: 'Portfolio Book',
            permission: Permission.VIEWER,
        });
        const context = {
            portfolioBook,
            accounts: [],
            resetEnabled: true,
        };
        view.portfolioBook = portfolioBook;
        view.initialDate = '2026-03-10';
        view.realizedResultsContext = context;
        view.hasViewerPermission = true;
        view.hasEditorPermission = true;
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        const markup = result.strings.join('');
        expect(markup).toContain('<realized-results');
        expect(markup).toContain('<forward-date');
        expect(result.values[0]).toBe(context);
        expect(result.values[1]).toBe('2026-03-10');
        expect(result.values[2]).toBeUndefined();
        expect(result.values[3]).toBe(false);
        expect(result.values[8]).toBe(true);
    });

    it('renders Forward Date after handling a service change', () => {
        const view = new BotAppView();
        const portfolioBook = new Book({
            id: 'portfolio-book',
            name: 'Portfolio Book',
            permission: Permission.VIEWER,
        });
        const context = {
            portfolioBook,
            accounts: [],
            fullResetEnabled: false,
        };
        view.portfolioBook = portfolioBook;
        view.initialDate = '2026-03-10';
        view.forwardDateContext = context;
        view.hasViewerPermission = true;
        view.hasEditorPermission = true;
        view.appState = BotAppState.READY;

        handleServiceChange.call(
            view,
            new CustomEvent('service-change', {
                detail: { service: PortfolioService.FORWARD_DATE },
            })
        );
        const result = renderBodyContent.call(view);

        const markup = result.strings.join('');
        expect(view.activeService).toBe(PortfolioService.FORWARD_DATE);
        expect(markup).toContain('<realized-results');
        expect(markup).toContain('<forward-date');
        expect(result.values[3]).toBe(true);
        expect(result.values[5]).toBe(context);
        expect(result.values[6]).toBe('2026-03-10');
        expect(result.values[7]).toBeUndefined();
        expect(result.values[8]).toBe(false);
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

        expect(result.strings.join('')).toContain('<realized-results');
        expect(result.values[2]).toBe(view.error);
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
