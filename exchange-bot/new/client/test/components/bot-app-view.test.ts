import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
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
const renderValidations = Reflect.get(BotAppView.prototype, 'renderValidations') as (
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
        view.error = { type: 'error', message: { before: 'Editor permission is required.' } };
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.values[0]).toBe(book);
        expect(result.values[1]).toBe(books);
        expect(result.values[2]).toBe(initialDate);
        expect(result.values[3]).toBe(false);
        expect(result.values[4]).toBe(view.error);
    });

    it('routes Book loading failures to the issue view', () => {
        const view = new BotAppView();
        view.bookId = 'book-id';
        view.error = {
            type: 'info',
            title: 'The selected Book could not be loaded.',
            message: { before: 'Please try again.' },
        };
        view.appState = BotAppState.ERROR;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<app-error');
        const error = result.values[0] as AppError;
        expect(error).toBe(view.error);
    });

    it('provides the Book access action when the user is not a collaborator', () => {
        const view = new BotAppView();
        view.bookId = 'book-id';
        view.error = {
            type: 'info',
            title: "You don't have access to this Book.",
            message: {
                action: {
                    label: 'Request access',
                    url: 'https://bkper.app/books/book-id/transactions',
                },
                after: 'in Bkper to continue.',
            },
        };
        view.appState = BotAppState.ERROR;

        const result = renderBodyContent.call(view);

        const error = result.values[0] as AppError;
        expect(error).toBe(view.error);
    });

    it('hides Exchange Update when the selected Book is not viewable', () => {
        const view = new BotAppView();
        view.book = new Book({ id: 'book-id', permission: Permission.RECORDER });
        view.bookId = 'book-id';
        view.error = {
            type: 'info',
            title: 'Insufficient Book permission.',
            message: {
                before: 'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.',
            },
        };
        view.appState = BotAppState.READY;

        const result = renderBodyContent.call(view);

        expect(result.strings.join('')).toContain('<app-error');
        expect(result.strings.join('')).not.toContain('<exchange-update');
        const error = result.values[0] as AppError;
        expect(error).toBe(view.error);
    });

    it('shows validation progress together with available warnings', () => {
        const view = new BotAppView();
        view.validating = true;
        view.warnings = ['Books with pending tasks: USD'];

        const validations = renderValidations.call(view);
        const warningSection = renderWarnings.call(view);
        const warnings = warningSection.values[0] as TemplateResult[];

        expect(validations.strings.join('')).toContain('<wa-spinner>');
        expect(validations.strings.join('')).toContain('Validating connected Books...');
        expect(validations.strings.join('')).toContain('role="status"');
        expect(warnings.map(warning => warning.values[0])).toEqual(view.warnings);
    });

    it('shows a validation error with a Retry action', () => {
        const view = new BotAppView();
        view.validationError = 'An error occurred while validating connected Books.';

        const result = renderValidations.call(view);

        expect(result.strings.join('')).toContain('role="alert"');
        expect(result.strings.join('')).toContain('<button');
        expect(result.strings.join('')).toContain('class="validation-retry focusable"');
        expect(result.strings.join('')).toContain('Retry');
        expect(result.values).toContain(view.validationError);
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
