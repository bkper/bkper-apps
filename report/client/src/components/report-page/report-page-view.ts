import type WaInput from '@awesome.me/webawesome-pro/dist/components/input/input.js';
import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { t, textDirection, type StringKey } from 'report-shared/strings';
import type { ReportResponse } from '../../api/app-api';
import type { AppState } from '../../state/app-state';
import { watch } from '../../state/store';
import { CHOOSE_SUGGESTION } from '../report-suggestions';
import '../report-suggestions';
import { reportPageCSS } from './report-page-css';

export type ReportPageState = Pick<AppState, 'route' | 'books' | 'reports' | 'strings'>;

/** Notices that say something failed, rather than hint. */
const ALERTS: ReadonlySet<StringKey> = new Set<StringKey>([
    'error_ai_allowance_exhausted',
    'error_book_load',
    'error_book_not_found',
    'error_forbidden',
    'error_upstream',
    'error_unexpected',
]);

/**
 * The app's one layout: the report, which scrolls, over an input fixed at the bottom that looks
 * like the Book's transaction input, so opening the app over a Book feels like changing layers.
 * The report builds as the person types (see `Reports`); the last one stays while the next is
 * on its way, with a thin progress line under the input, and changes into the next one in place
 * with a view transition where the browser has them. Suggestions and notices sit just over the
 * input. Without a Book, the page shows its content (the Book picker) over a disabled input.
 */
@customElement('report-page')
export class ReportPage extends LitElement {
    static styles = reportPageCSS;

    @property({ attribute: false }) state!: ReportPageState;

    /** The report on screen: it follows the store's, through a view transition. */
    @state() private shown?: ReportResponse;
    @query('wa-input') private input?: WaInput;
    @query('.report') private reportArea?: HTMLElement;
    @query('.scroll') private scroller?: HTMLElement;
    private morphing = false;
    /** The input has had focus since the Book opened. */
    private focused = false;

    constructor() {
        super();
        watch(this, () => [
            this.state.route,
            this.state.books,
            this.state.reports,
            this.state.strings,
        ]);
    }

    /** A Book is open, so the input asks for its reports. */
    private get bookOpen(): boolean {
        return !!this.state.route.bookId && !this.state.books.appError;
    }

    protected willUpdate(): void {
        this.follow();
    }

    protected updated(changed: PropertyValues): void {
        const { books, strings } = this.state;
        const report = this.shown && reportTitle(this.shown);
        const book = books.bookName ?? '';
        document.title =
            report && book
                ? t('report_document_title', strings.language, { report, book })
                : report || book || t('app_title', strings.language);
        // A new report starts at its answer.
        if (changed.has('shown')) this.scroller?.scrollTo({ top: 0 });
        if (!this.bookOpen) this.focused = false;
        else if (!this.focused) {
            this.focused = true;
            void this.focusInput();
        }
    }

    render() {
        const { books, reports } = this.state;
        const lang = this.state.strings.language;
        const open = this.bookOpen;
        return html`
            <div class="page" lang=${lang} dir=${textDirection(lang)}>
                <main class="scroll">
                    <div class="content">
                        <slot></slot>
                        ${
                            open && this.shown
                                ? html`<report-view
                                      class="report"
                                      .spec=${this.shown.spec}
                                  ></report-view>`
                                : nothing
                        }
                    </div>
                </main>
                <div class="dock">
                    ${
                        // One message at a time: the API's says why the Book cannot be read.
                        open
                            ? this.renderNotice(reports.notice ?? books.selectedBookError, lang)
                            : nothing
                    }
                    ${
                        open && reports.showsSuggestions
                            ? html`<report-suggestions
                                  class="suggestions"
                                  .suggestions=${reports.suggestions}
                                  label=${t('suggestions_label', lang)}
                                  loading-label=${t('suggestions_loading', lang)}
                                  @report-choose-suggestion=${this.onChoose}
                              ></report-suggestions>`
                            : nothing
                    }
                    <div class="bar">
                        <wa-input
                            class="prompt"
                            pill
                            autofocus
                            with-clear
                            autocomplete="off"
                            inputmode="text"
                            enterkeyhint="send"
                            ?disabled=${!open}
                            label=${t('input_label', lang)}
                            placeholder=${t('input_placeholder', lang)}
                            .value=${live(reports.text)}
                            @input=${this.onInput}
                            @keydown=${this.onKeyDown}
                        ></wa-input>
                        <wa-progress-bar
                            class="progress ${reports.pending ? 'active' : ''}"
                            indeterminate
                            label=${t('status_loading', lang)}
                            aria-hidden=${reports.pending ? 'false' : 'true'}
                        ></wa-progress-bar>
                    </div>
                </div>
            </div>
        `;
    }

    private renderNotice(notice: StringKey | null | undefined, lang: string) {
        if (!notice) return nothing;
        const alert = ALERTS.has(notice);
        return html`<p class="notice ${alert ? 'alert' : ''}" role=${alert ? 'alert' : 'status'}>
            ${t(notice, lang)}
        </p>`;
    }

    private onInput = () => this.state.reports.input(this.input?.value ?? '');

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        if (event.key === 'Enter') this.state.reports.submit();
        else if (event.key === 'Escape' && this.state.reports.text) {
            event.preventDefault();
            this.state.reports.input('');
        }
    };

    private onChoose = (event: HTMLElementEventMap[typeof CHOOSE_SUGGESTION]) => {
        this.state.reports.choose(event.detail);
        this.input?.focus();
    };

    private async focusInput(): Promise<void> {
        await this.input?.updateComplete;
        this.input?.focus();
    }

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

declare global {
    interface HTMLElementTagNameMap {
        'report-page': ReportPage;
    }
}
