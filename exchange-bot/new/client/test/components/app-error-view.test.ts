import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { AppErrorView } from '../../src/components/app-error/app-error-view.js';

const render = Reflect.get(AppErrorView.prototype, 'render') as (
    this: AppErrorView
) => TemplateResult;

describe('App error view', () => {
    it('offers to request access when the Book exists but is inaccessible', () => {
        const view = new AppErrorView();
        view.bookId = 'book-id';
        view.permissionError = "You don't have access to this Book.";

        const result = render.call(view);

        expect(result.strings.join('')).toContain('target="_blank"');
        expect(result.strings.join('')).toContain('rel="noopener noreferrer"');
        expect(result.values).toContain("You don't have access to this Book.");
        expect(result.values).toContain('https://bkper.app/books/book-id/transactions');
    });

    it('renders the existing permission message for a loaded Book', () => {
        const view = new AppErrorView();
        view.book = new Book({ id: 'book-id', permission: Permission.RECORDER });
        view.permissionError =
            'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.';

        const result = render.call(view);

        expect(result.strings.join('')).toContain('role="alert"');
        expect(result.values).toContain(view.permissionError);
        expect(result.strings.join('')).not.toContain('Request access');
    });

    it('renders Book loading errors', () => {
        const view = new AppErrorView();
        view.error = 'The selected Book could not be loaded. Please try again.';

        const result = render.call(view);

        expect(result.strings.join('')).toContain('role="alert"');
        expect(result.values).toContain(view.error);
    });
});
