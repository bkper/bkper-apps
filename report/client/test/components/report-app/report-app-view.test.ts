import { describe, expect, it } from 'vitest';
import { render } from 'lit';
import { t } from 'report-shared/strings';
import '../../../src/web-awesome';
import { ReportApp } from '../../../src/components/report-app/report-app-view';

describe('ReportApp component', () => {
    it('renders the loading state with Web Awesome components', () => {
        const app = new ReportApp();
        const container = document.createElement('div');

        render(app.render(), container);

        const SpinnerElement = customElements.get('wa-spinner');
        if (!SpinnerElement) {
            throw new Error('Web Awesome components were not registered');
        }
        expect(container.querySelector('wa-spinner')).toBeInstanceOf(SpinnerElement);
        expect(container.textContent).toContain(t('app_loading', 'en'));
        // Above the input, which shows from the first frame.
        expect(container.querySelector('wa-spinner')?.closest('report-page')).not.toBeNull();
    });

    it('renders an initial data failure instead of an empty Book list', () => {
        const app = new ReportApp();
        app.state.books.loading = false;
        app.state.books.appError = 'error_load_data';
        const container = document.createElement('div');

        render(app.render(), container);

        const callout = container.querySelector('wa-callout');
        expect(callout?.getAttribute('variant')).toBe('danger');
        expect(callout?.textContent?.trim()).toBe(t('error_load_data', 'en'));
        expect(container.querySelector('book-picker')).toBeNull();
    });

    it('renders the Book picker of the person Books, which opens the chosen one', () => {
        const app = new ReportApp();
        app.state.books.loading = false;
        app.state.books.books = [{ id: 'book-1', name: 'Main Book' }];
        const container = document.createElement('div');

        render(app.render(), container);

        const picker = container.querySelector('book-picker');
        expect(picker?.books).toEqual([{ id: 'book-1', name: 'Main Book' }]);
        expect(picker?.language).toBe('en');
        expect(picker?.parentElement?.localName).toBe('report-page');
    });

    it('renders the report page of the selected Book at once, while the Book loads', () => {
        const app = new ReportApp();
        app.state.books.loading = true;
        app.state.route.bookId = 'book-1';
        const container = document.createElement('div');

        render(app.render(), container);

        expect(container.querySelector('report-page')?.state).toBe(app.state);
        expect(container.querySelector('report-page')?.children).toHaveLength(0);
    });
});
