import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { t } from 'report-shared/strings';
import type { BookListItem } from '../../services/book-service';
import { AppState } from '../../state/app-state';
import type { Books } from '../../state/books';
import { watch } from '../../state/store';
import '../report-page/report-page-view';
import { reportAppCSS } from './report-app-css';

@customElement('report-app')
export class ReportApp extends LitElement {
    static styles = reportAppCSS;

    readonly state = new AppState();

    constructor() {
        super();
        watch(this, () => [this.state.route, this.state.books]);
    }

    connectedCallback(): void {
        super.connectedCallback();
        this.state.connect();
    }

    disconnectedCallback(): void {
        super.disconnectedCallback();
        this.state.disconnect();
    }

    render() {
        const state = this.state.books;

        // The report page shows at once: its request runs while the Book's name loads.
        const bookId = this.state.route.bookId;
        if (bookId && !state.appError) {
            return html`<report-page .state=${this.state}></report-page>`;
        }

        if (state.loading) {
            return html`
                <div class="container">
                    <wa-card appearance="outlined">
                        <div class="loading-content" role="status">
                            <wa-spinner></wa-spinner>
                            <span>Loading...</span>
                        </div>
                    </wa-card>
                </div>
            `;
        }

        if (state.appError) {
            return html`
                <div class="container">
                    <wa-card appearance="outlined">
                        ${this.renderCallout(state.appError, 'danger')}
                    </wa-card>
                </div>
            `;
        }

        // Book picker: show list of books.
        return this.renderBookPicker(state);
    }

    private renderBookPicker(state: Books) {
        return html`
            <div class="container">
                <wa-card appearance="outlined">
                    <div slot="header" class="panel-header">
                        <p class="eyebrow">Report</p>
                        <h1>Hello, ${state.userDisplayName}!</h1>
                        <p class="subtitle">
                            ${t('book_picker_title', this.state.reports.language)}
                        </p>
                    </div>
                    ${
                        state.books.length === 0
                            ? this.renderCallout(
                                  t('book_picker_empty', this.state.reports.language)
                              )
                            : html`
                                  <div class="book-list">
                                      ${state.books.map(this.renderBookButton)}
                                  </div>
                              `
                    }
                </wa-card>
            </div>
        `;
    }

    private renderBookButton = (book: BookListItem) => html`
        <wa-button
            class="book-button"
            variant="neutral"
            appearance="outlined"
            @click=${() => this.state.select(book.id)}
        >
            <span class="book-button-content">
                <span class="book-name">${book.name}</span>
                <span class="hint">Open</span>
            </span>
        </wa-button>
    `;

    private renderCallout(message: string, variant: 'neutral' | 'danger' = 'neutral') {
        return html`
            <wa-callout variant=${variant} appearance="outlined" size="s">${message}</wa-callout>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'report-app': ReportApp;
    }
}
