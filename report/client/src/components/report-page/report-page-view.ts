import type WaInput from '@awesome.me/webawesome-pro/dist/components/input/input.js';
import { LitElement, html, nothing, svg } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { t } from 'report-shared/strings';
import type { ReportResponse } from '../../api/app-api';
import type { AppState } from '../../state/app-state';
import type { Notice } from '../../state/reports';
import { watch } from '../../state/store';
import { CHOOSE_SUGGESTION } from '../report-suggestions';
import '../report-suggestions';
import { reportPageCSS } from './report-page-css';

export type ReportPageState = Pick<AppState, 'books' | 'reports' | 'strings' | 'select'>;

/** Notices that say something failed, rather than hint. */
const ALERTS: ReadonlySet<Notice> = new Set<Notice>([
    'error_ai_allowance_exhausted',
    'error_book_not_found',
    'error_forbidden',
    'error_upstream',
    'error_unexpected',
]);

const BACK = svg`<path d="m15 18-6-6 6-6"/>`;
const ASK = svg`<path d="M3 3v18h18"/><path d="M8 17v-4M12 17V9M16 17v-6"/>`;

/**
 * A Book's report page: one input, no button, and the report below it. The report builds as the
 * person types (see `Reports`); the last one stays while the next is on its way, with a thin
 * progress line under the input, and changes into the next one with a view transition where
 * the browser has them. Suggestions show under the empty input.
 */
@customElement('report-page')
export class ReportPage extends LitElement {
    static styles = reportPageCSS;

    @property({ attribute: false }) state!: ReportPageState;

    /** The report on screen: it follows the store's, through a view transition. */
    @state() private shown?: ReportResponse;
    @query('wa-input') private input?: WaInput;
    @query('.report') private reportArea?: HTMLElement;
    private morphing = false;

    constructor() {
        super();
        watch(this, () => [this.state.books, this.state.reports, this.state.strings]);
    }

    protected willUpdate(): void {
        this.follow();
    }

    protected async firstUpdated(): Promise<void> {
        await this.input?.updateComplete;
        this.input?.focus();
    }

    protected updated(): void {
        const { books, strings } = this.state;
        const report = this.shown && reportTitle(this.shown);
        const book = books.bookName ?? '';
        document.title =
            report && book
                ? t('report_document_title', strings.language, { report, book })
                : report || book || t('app_title', strings.language);
    }

    render() {
        const { books, reports } = this.state;
        const lang = this.state.strings.language;
        return html`
            <div class="page">
                <header class="bar">
                    <wa-button
                        class="back"
                        appearance="plain"
                        size="s"
                        @click=${() => this.state.select(undefined)}
                    >
                        ${glyph(BACK, 'start')} ${t('books_back', lang)}
                    </wa-button>
                    ${books.bookName ? html`<span class="book">${books.bookName}</span>` : nothing}
                </header>
                ${
                    books.selectedBookError
                        ? html`<p class="notice alert" role="alert">
                              ${t(books.selectedBookError, lang)}
                          </p>`
                        : nothing
                }
                <div class="ask">
                    <wa-input
                        class="prompt"
                        size="l"
                        autofocus
                        with-clear
                        autocomplete="off"
                        enterkeyhint="go"
                        label=${t('input_label', lang)}
                        placeholder=${t('input_placeholder', lang)}
                        .value=${live(reports.text)}
                        @input=${this.onInput}
                        @keydown=${this.onKeyDown}
                    >
                        ${glyph(ASK, 'start')}
                    </wa-input>
                    <wa-progress-bar
                        class="progress ${reports.pending ? 'active' : ''}"
                        indeterminate
                        label=${t('status_loading', lang)}
                        aria-hidden=${reports.pending ? 'false' : 'true'}
                    ></wa-progress-bar>
                </div>
                ${this.renderNotice(reports.notice, lang)}
                ${
                    reports.showsSuggestions
                        ? html`<report-suggestions
                              .suggestions=${reports.suggestions}
                              label=${t('suggestions_label', lang)}
                              loading-label=${t('suggestions_loading', lang)}
                              @report-choose-suggestion=${this.onChoose}
                          ></report-suggestions>`
                        : nothing
                }
                ${
                    this.shown
                        ? html`<report-view class="report" .spec=${this.shown.spec}></report-view>`
                        : nothing
                }
            </div>
        `;
    }

    private renderNotice(notice: Notice | undefined, lang: string) {
        if (!notice) return nothing;
        const alert = ALERTS.has(notice);
        return html`<p class="notice ${alert ? 'alert' : ''}" role=${alert ? 'alert' : 'status'}>
            ${t(notice, lang)}
        </p>`;
    }

    private onInput = () => this.state.reports.input(this.input?.value ?? '');

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.isComposing) this.state.reports.submit();
    };

    private onChoose = (event: HTMLElementEventMap[typeof CHOOSE_SUGGESTION]) => {
        this.state.reports.choose(event.detail);
        this.input?.focus();
    };

    /**
     * Show the store's report, changing into it with a view transition when one is on screen.
     * Runs before each render: the transition captures the page as it is, then shows the next.
     */
    private follow(): void {
        const next = this.state.reports.report;
        if (next === this.shown || this.morphing) return;
        const morph = this.reportArea && this.shown && next ? morphOf(this.reportArea) : undefined;
        if (!morph) {
            this.shown = next;
            return;
        }
        this.morphing = true;
        const transition = morph(async () => {
            this.shown = next;
            await this.updateComplete;
            await this.renderRoot.querySelector('report-view')?.updateComplete;
        });
        // A report that answered meanwhile follows once this one is in place.
        void transition.updateCallbackDone.finally(() => {
            this.morphing = false;
            this.requestUpdate();
        });
    }
}

interface ViewTransitionScope {
    startViewTransition(update: ViewTransitionUpdateCallback): ViewTransition;
}

function isViewTransitionScope(target: object): target is ViewTransitionScope {
    return 'startViewTransition' in target && typeof target.startViewTransition === 'function';
}

/**
 * How to change the report with a view transition: scoped to the report where the browser can,
 * so the input stays live and still; else over the whole page; none without support or when
 * the person prefers reduced motion.
 */
function morphOf(area: HTMLElement): ViewTransitionScope['startViewTransition'] | undefined {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (isViewTransitionScope(area)) return update => area.startViewTransition(update);
    if (isViewTransitionScope(document)) return update => document.startViewTransition(update);
    return undefined;
}

function reportTitle(report: ReportResponse): string | undefined {
    const root = report.spec.elements[report.spec.root];
    return root?.type === 'Report' ? root.props.title : undefined;
}

function glyph(paths: ReturnType<typeof svg>, slot: string) {
    return html`<svg
        slot=${slot}
        class="glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        ${paths}
    </svg>`;
}

declare global {
    interface HTMLElementTagNameMap {
        'report-page': ReportPage;
    }
}
