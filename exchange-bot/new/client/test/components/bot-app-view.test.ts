import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { BotAppState } from '../../src/components/bot-app-controller.js';
import { BotAppView } from '../../src/components/bot-app-view.js';

const renderHeader = Reflect.get(BotAppView.prototype, 'renderHeader') as (
    this: BotAppView
) => TemplateResult;
const renderBodyContent = Reflect.get(BotAppView.prototype, 'renderBodyContent') as (
    this: BotAppView
) => TemplateResult;
const renderPermissionError = Reflect.get(BotAppView.prototype, 'renderPermissionError') as (
    this: BotAppView
) => TemplateResult;
const renderContextWarning = Reflect.get(BotAppView.prototype, 'renderContextWarning') as (
    this: BotAppView
) => TemplateResult;

describe('Bot app view', () => {
    it('passes the selected Book to the app header', () => {
        const view = new BotAppView();
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'America/New_York',
            permission: Permission.EDITOR,
        });
        view.book = book;

        const result = renderHeader.call(view);

        expect(result.values[0]).toBe(book);
    });

    it('does not render the app header in embedded mode', () => {
        const view = new BotAppView();
        view.embedded = true;

        const result = renderHeader.call(view);

        expect(result.strings.join('')).toBe('');
    });

    it('passes the initialized Book and context Books to the exchange update child', () => {
        const view = new BotAppView();
        const book = new Book({ id: 'book-id' });
        const books = [{ book, excCode: 'USD', isBase: true }];
        const initialDate = '2026-08-06';
        view.book = book;
        view.books = books;
        view.initialDate = initialDate;
        view.hasViewerPermission = true;
        view.hasEditorPermission = true;
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.values[0]).toBe(book);
        expect(result.values[1]).toBe(books);
        expect(result.values[2]).toBe(initialDate);
        expect(result.values[3]).toBe(true);
    });

    it('hides Exchange Update when the selected Book is not viewable', () => {
        const view = new BotAppView();
        view.book = new Book({ id: 'book-id', permission: Permission.RECORDER });
        view.permissionError =
            'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.';
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).not.toContain('<exchange-update');
        expect(result.values).toContain(
            'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.'
        );
    });

    it('renders menu initialization warnings', () => {
        const view = new BotAppView();
        view.permissionError = 'There are pending bot tasks in USD book';

        const result = renderPermissionError.call(view);

        expect(result.values).toContain('There are pending bot tasks in USD book');
    });

    it('renders a missing connected-Book warning separately', () => {
        const view = new BotAppView();
        view.contextWarning =
            'Some configured currencies do not have a visible connected Book: BRL';

        const result = renderContextWarning.call(view);

        expect(result.values).toContain(view.contextWarning);
        expect(result.strings.join('')).toContain('role="status"');
    });
});
