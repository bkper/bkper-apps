import { describe, expect, it } from 'vitest';
import { render } from 'lit';
import '../../../src/web-awesome';
import { ReportApp } from '../../../src/components/report-app/report-app-view';

describe('ReportApp component', () => {
    it('renders the loading state with Web Awesome components', () => {
        const app = new ReportApp();
        const container = document.createElement('div');

        render(app.render(), container);

        const CardElement = customElements.get('wa-card');
        const SpinnerElement = customElements.get('wa-spinner');
        const card = container.querySelector('wa-card');
        const spinner = container.querySelector('wa-spinner');

        if (!CardElement || !SpinnerElement) {
            throw new Error('Web Awesome components were not registered');
        }

        expect(card).toBeInstanceOf(CardElement);
        expect(spinner).toBeInstanceOf(SpinnerElement);
    });

    it('renders an initial data failure instead of an empty Book list', () => {
        const app = new ReportApp();
        app.state.books.loading = false;
        app.state.books.appError = 'Could not load your Bkper data. Please reload and try again.';
        const container = document.createElement('div');

        render(app.render(), container);

        const callout = container.querySelector('wa-callout');
        expect(callout?.getAttribute('variant')).toBe('danger');
        expect(callout?.textContent).toContain(
            'Could not load your Bkper data. Please reload and try again.'
        );
        expect(container.textContent).not.toContain('No books found');
    });

    it('renders one direct Book picker without duplicating the list through the app API', () => {
        const app = new ReportApp();
        app.state.books.loading = false;
        app.state.books.userDisplayName = 'Ada';
        app.state.books.books = [{ id: 'book-1', name: 'Main Book' }];
        const container = document.createElement('div');

        render(app.render(), container);

        expect(container.querySelectorAll('wa-card')).toHaveLength(1);
        expect(container.textContent).toContain('Main Book');
    });

    it('renders the selected Book, or a visible error when it cannot load', () => {
        const app = new ReportApp();
        app.state.books.loading = false;
        app.state.route.bookId = 'book-1';
        app.state.books.bookName = 'Main Book';
        const container = document.createElement('div');

        render(app.render(), container);
        expect(container.querySelector('h1')?.textContent).toBe('Main Book');

        app.state.books.bookName = null;
        app.state.books.selectedBookError = 'Could not load this Book.';
        render(app.render(), container);
        const callout = container.querySelector('wa-callout');
        expect(callout?.getAttribute('variant')).toBe('danger');
        expect(callout?.textContent).toContain('Could not load this Book.');
    });
});
