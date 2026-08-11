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
const renderWarnings = Reflect.get(BotAppView.prototype, 'renderWarnings') as (
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
        view.hasEditorPermission = false;
        view.permissionError = 'Editor permission is required.';
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.values[0]).toBe(book);
        expect(result.values[1]).toBe(books);
        expect(result.values[2]).toBe(initialDate);
        expect(result.values[3]).toBe(false);
        expect(result.values[4]).toBe('Editor permission is required.');
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

    it('renders blocking permission errors', () => {
        const view = new BotAppView();
        view.permissionError = 'Required Book permission: EDITOR or OWNER. Current: VIEWER.';

        const result = renderPermissionError.call(view);

        expect(result.values).toContain(
            'Required Book permission: EDITOR or OWNER. Current: VIEWER.'
        );
    });

    it('renders every context warning separately', () => {
        const view = new BotAppView();
        view.warnings = [
            'Some configured currencies do not have a visible connected Book: BRL',
            'There are pending bot tasks in USD book',
            'There are bot errors in EUR book',
        ];

        const result = renderWarnings.call(view);
        const warnings = result.values[0] as TemplateResult[];

        expect(warnings).toHaveLength(3);
        expect(warnings.map(warning => warning.values[0])).toEqual(view.warnings);
        for (const warning of warnings) {
            expect(warning.strings.join('')).toContain('role="status"');
        }
    });
});
