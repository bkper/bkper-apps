import { LitElement, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { t } from 'report-shared/strings';
import { AppState } from '../../state/app-state';
import { watch } from '../../state/store';
import { CHOOSE_BOOK } from '../book-picker';
import '../book-picker';
import '../report-page/report-page-view';
import { reportAppCSS } from './report-app-css';
import { VisualViewportController } from './visual-viewport';

@customElement('report-app')
export class ReportApp extends LitElement {
    static styles = reportAppCSS;

    readonly state = new AppState();
    /** Keeps the app, and its input, above the on-screen keyboard. */
    readonly viewport = new VisualViewportController(this);

    constructor() {
        super();
        watch(this, () => [this.state.route, this.state.books, this.state.strings]);
    }

    connectedCallback(): void {
        super.connectedCallback();
        this.state.connect();
    }

    disconnectedCallback(): void {
        super.disconnectedCallback();
        this.state.disconnect();
    }

    /**
     * One layout everywhere: the report page, with its input at the bottom from the first frame.
     * Without a Book, what shows above the input is the Book picker, or its loading or error.
     */
    render() {
        return html`<report-page .state=${this.state}>${this.renderWithoutBook()}</report-page>`;
    }

    private renderWithoutBook() {
        const state = this.state.books;
        const lang = this.state.strings.language;

        // The report page shows at once: its request runs while the Book's name loads.
        if (this.state.route.bookId && !state.appError) return nothing;

        if (state.loading) {
            return html`
                <div class="loading" role="status">
                    <wa-spinner></wa-spinner>
                    <span>${t('app_loading', lang)}</span>
                </div>
            `;
        }

        if (state.appError) {
            return html`
                <div class="container">
                    <wa-callout variant="danger" appearance="outlined" size="s">
                        ${t(state.appError, lang)}
                    </wa-callout>
                </div>
            `;
        }

        return html`<book-picker
            .books=${state.books}
            language=${lang}
            @report-choose-book=${this.onChooseBook}
        ></book-picker>`;
    }

    private onChooseBook = (event: HTMLElementEventMap[typeof CHOOSE_BOOK]) => {
        this.state.select(event.detail);
    };
}

declare global {
    interface HTMLElementTagNameMap {
        'report-app': ReportApp;
    }
}
