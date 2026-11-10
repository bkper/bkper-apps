import type WaInput from '@awesome.me/webawesome-pro/dist/components/input/input.js';
import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { isolate } from 'report-shared/bidi';
import type { NameCompletion, NameIndex } from 'report-shared/name-index';
import { t, textDirection, type StringKey } from 'report-shared/strings';
import { formatCount, formatList } from '../../agent-link';
import type { BookProblem, ReportResponse } from '../../api/app-api';
import { plainClick } from '../../bkper-host';
import type { AppState } from '../../state/app-state';
import { SELECT_TEXT } from '../../state/reports';
import { on, watch } from '../../state/store';
import type { OPEN_IN_BKPER, SELECT_CHART } from '../../report/index';
import { CHOOSE_SUGGESTION } from '../report-suggestions';
import { OPEN_SAVED_REPORT } from '../report-shelf';
import '../report-shelf';
import { NameCompletionController, type Caret } from './name-completion';
import { reportPageCSS } from './report-page-css';

export type ReportPageState = Pick<
    AppState,
    | 'route'
    | 'books'
    | 'reports'
    | 'strings'
    | 'savedReports'
    | 'openSavedReport'
    | 'names'
    | 'agentLink'
    | 'openAgent'
    | 'openInBkper'
>;

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
    @query('.dock') private dock?: HTMLElement;
    @query('[role="listbox"]') private listbox?: HTMLElement;
    private morphing = false;
    /** The input has had focus since the Book opened. */
    private focused = false;
    /** The Book's names completing the word at the caret, as the person types. */
    private readonly completion = new NameCompletionController(this, applied =>
        this.acceptCompletion(applied.text, applied.caret)
    );
    /** An input method is composing text: nothing completes until it ends. */
    private composing = false;
    /** The names the completions shown were found in. */
    private completedFrom?: NameIndex;

    constructor() {
        super();
        watch(this, () => [
            this.state.route,
            this.state.books,
            this.state.reports,
            this.state.strings,
            this.state.names,
        ]);
        on(
            this,
            () => this.state.reports,
            SELECT_TEXT,
            () => void this.selectRequest()
        );
    }

    /** A Book is open, so the input asks for its reports. */
    private get bookOpen(): boolean {
        return !!this.state.route.bookId && !this.state.books.appError;
    }

    protected willUpdate(): void {
        this.follow();
        // The names belong to the request they complete: another request closes them.
        this.completion.follow(this.state.reports.text);
        // Names that arrive, or change, while the person types complete the word at the caret.
        if (this.completedFrom !== this.state.names.index && this.inputFocused) {
            this.complete(false);
        }
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
        this.describeCombobox();
    }

    protected firstUpdated(): void {
        // The `<input>` renders with the `wa-input`, after the page.
        void this.input?.updateComplete.then(() => this.describeCombobox());
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
                                      .chart=${
                                          this.shown === reports.report ? reports.chart : undefined
                                      }
                                      @report-select-chart=${this.onSelectChart}
                                      @report-open-in-bkper=${this.onOpenInBkper}
                                  ></report-view>`
                                : nothing
                        }
                    </div>
                </main>
                ${this.renderCompletions(lang)}
                <div class="dock">
                    ${
                        // One message at a time: the API's says why the Book cannot be read.
                        !open
                            ? nothing
                            : reports.problem
                              ? this.renderProblem(reports.problem, lang)
                              : this.renderNotice(reports.notice ?? books.selectedBookError, lang)
                    }
                    ${
                        open
                            ? html`<report-shelf
                                  .state=${this.state}
                                  .current=${this.shown === reports.report}
                                  @report-choose-suggestion=${this.onChoose}
                                  @report-open-saved=${this.onOpenSaved}
                              ></report-shelf>`
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
                            @keyup=${this.onKeyUp}
                            @click=${this.onCaretMove}
                            @focusin=${this.onFocus}
                            @focusout=${this.onBlur}
                            @compositionstart=${this.onCompositionStart}
                            @compositionend=${this.onCompositionEnd}
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

    /**
     * The names completing the word at the caret: a listbox above the input and what sits on it
     * (the shelf, a notice), so the input and the shelf stay in view and usable. The input stays
     * focused (a list-autocomplete combobox, `aria-activedescendant`); a press on a name keeps
     * the focus, so a tap does not close the on-screen keyboard.
     */
    private renderCompletions(lang: string) {
        const { items, active, open } = this.completion;
        return html`<wa-popup
            class="completions"
            placement="top-start"
            distance="4"
            shift
            auto-size="vertical"
            .anchor=${this.dock}
            ?active=${open}
        >
            <div
                class="listbox"
                role="listbox"
                aria-label=${t('completion_label', lang)}
                @pointerdown=${keepFocus}
                @mousedown=${keepFocus}
            >
                ${items.map((item, index) => this.renderCompletion(item, index === active, index, lang))}
            </div>
        </wa-popup>`;
    }

    private renderCompletion(item: NameCompletion, active: boolean, index: number, lang: string) {
        const kind = item.name.kind === 'group' ? 'completion_group' : 'completion_account';
        return html`<div
            class="option ${active ? 'active' : ''}"
            role="option"
            aria-selected=${active ? 'true' : 'false'}
            @click=${() => this.completion.choose(index)}
        >
            <bdi class="name">${item.text}</bdi>
            <span class="kind">${t(kind, lang)}</span>
        </div>`;
    }

    private renderNotice(notice: StringKey | null | undefined, lang: string) {
        if (!notice) return nothing;
        const alert = ALERTS.has(notice);
        return html`<p class="notice ${alert ? 'alert' : ''}" role=${alert ? 'alert' : 'status'}>
            ${t(notice, lang)}
        </p>`;
    }

    /**
     * What keeps the Book from its reports, and what to do: for a person who may organize the
     * Book, a link to the Bkper Agent with the request ready; for others, to ask the owner.
     */
    private renderProblem(problem: BookProblem, lang: string) {
        const link = this.state.agentLink(problem);
        const empty = problem.code === 'empty_book';
        const ask = empty ? 'problem_ask_owner_start' : 'problem_ask_owner';
        return html`<div class="notice problem" role="status">
            <p class="message">${problemMessage(problem, lang)} ${link ? nothing : t(ask, lang)}</p>
            ${
                link
                    ? html`<wa-button
                          class="agent"
                          size="s"
                          pill
                          appearance="outlined"
                          variant="brand"
                          href=${link.url}
                          target=${link.newTab ? '_blank' : nothing}
                          @click=${(event: MouseEvent) => this.onOpenAgent(event, problem)}
                          >${t(empty ? 'action_agent_start' : 'action_agent_organize', lang)}</wa-button
                      >`
                    : nothing
            }
        </div>`;
    }

    /** A plain click opens the Agent in place where the Book can; else the link opens. */
    private onOpenAgent(event: MouseEvent, problem: BookProblem): void {
        if (plainClick(event) && this.state.openAgent(problem)) event.preventDefault();
    }

    private onInput = (event: Event) => {
        this.state.reports.input(this.input?.value ?? '');
        if (this.composing || (event instanceof InputEvent && event.isComposing)) {
            this.completion.close();
        } else this.complete(true);
    };

    private onKeyDown = (event: KeyboardEvent) => {
        // The keys that confirm an input method's text are its own (Safari says so with 229).
        if (event.isComposing || event.keyCode === 229) return;
        if (this.completion.keydown(event)) return;
        if (event.key === 'Enter') this.state.reports.submit();
        else if (event.key === 'Escape' && this.state.reports.text) {
            event.preventDefault();
            this.state.reports.input('');
        }
    };

    /** Keys that move the caret: the word at it may complete another name. */
    private onKeyUp = (event: KeyboardEvent) => {
        if (CARET_KEYS.has(event.key) && !this.composing) this.complete(true);
    };

    private onCaretMove = () => {
        if (!this.composing) this.complete(true);
    };

    private onFocus = () => {
        if (!this.composing) this.complete(false);
    };

    private onBlur = () => this.completion.close();

    private onCompositionStart = () => {
        this.composing = true;
        this.completion.close();
    };

    private onCompositionEnd = () => {
        this.composing = false;
        this.complete(true);
    };

    /** Find the names completing the word at the caret, from memory; `moved` by the person. */
    private complete(moved: boolean): void {
        const { names } = this.state;
        this.completedFrom = names.index;
        this.completion.update(names, this.caret(), moved);
    }

    /** The input's text and selection, while it has the focus. */
    private caret(): Caret | undefined {
        const field = this.input?.input;
        if (!field || !this.inputFocused) return undefined;
        const start = field.selectionStart ?? field.value.length;
        return { text: field.value, start, end: field.selectionEnd ?? start };
    }

    private get inputFocused(): boolean {
        return !!this.input && this.shadowRoot?.activeElement === this.input;
    }

    /**
     * Write the request a name completed into the input, the caret after the name, at once, so
     * the next keystroke lands after it; then ask for its report as typing does.
     */
    private acceptCompletion(text: string, caret: number): void {
        const field = this.input;
        if (field?.input) {
            field.input.value = text;
            field.input.setSelectionRange(caret, caret);
            field.value = text;
        }
        this.state.reports.input(text);
        if (field && !this.inputFocused) field.focus();
    }

    /**
     * The input as a list-autocomplete combobox. Its `<input>` is in the shadow root of the
     * `wa-input`, so the listbox and its options, in the page's, are referred to as elements.
     */
    private describeCombobox(): void {
        const field = this.input?.input;
        if (!field) return;
        const { open } = this.completion;
        field.setAttribute('role', 'combobox');
        field.setAttribute('aria-autocomplete', 'list');
        field.setAttribute('aria-expanded', open ? 'true' : 'false');
        field.ariaControlsElements = open && this.listbox ? [this.listbox] : null;
        field.ariaActiveDescendantElement =
            (open && this.listbox?.querySelector('[aria-selected="true"]')) || null;
    }

    private onSelectChart = (event: HTMLElementEventMap[typeof SELECT_CHART]) =>
        this.state.reports.chooseChart(event.detail.kind);

    /** In a Book that navigates for the app, the report's query opens in place, not in a new tab. */
    private onOpenInBkper = (event: HTMLElementEventMap[typeof OPEN_IN_BKPER]) => {
        if (this.state.openInBkper(event.detail.url)) event.preventDefault();
    };

    private onChoose = (event: HTMLElementEventMap[typeof CHOOSE_SUGGESTION]) => {
        this.state.reports.choose(event.detail);
        this.input?.focus();
    };

    private onOpenSaved = (event: HTMLElementEventMap[typeof OPEN_SAVED_REPORT]) => {
        this.state.openSavedReport(event.detail);
        this.input?.focus();
    };

    private async focusInput(): Promise<void> {
        await this.input?.updateComplete;
        this.input?.focus();
    }

    /**
     * The request was opened for the person: once the input shows it, select it, the focus in
     * the input, so the first keystroke replaces it.
     */
    private async selectRequest(): Promise<void> {
        await this.updateComplete;
        const field = this.input;
        if (!field || field.disabled) return;
        await field.updateComplete;
        field.focus();
        field.select();
    }

    /**
     * Show the store's report, changing into it with a view transition when one is on screen.
     * Runs before each render: the transition captures the page as it is, then shows the next.
     */
    private follow(): void {
        const next = this.state.reports.report;
        if (next === this.shown || this.morphing) return;
        // The visible scroll area, never larger than the screen: a report taller than the
        // largest snapshot the browser takes is captured smaller, then shown scaled up.
        const area = this.scroller;
        const morph = area && this.reportArea && this.shown && next ? morphOf(area) : undefined;
        if (!area || !morph) {
            this.shown = next;
            return;
        }
        this.morphing = true;
        // Scoped to the area, the page keeps drawing while the transition waits, so it captures
        // the next report with its chart drawn; over the whole page nothing draws until then.
        const scoped = isViewTransitionScope(area);
        const transition = morph(async () => {
            this.shown = next;
            await this.updateComplete;
            const view = this.renderRoot.querySelector('report-view');
            await (scoped ? view?.chartDrawn?.() : view?.updateComplete);
        });
        // The browser skips a transition when another starts or the area is hidden or replaced:
        // the report still changes, only without the animation, which is no error.
        transition.ready.catch(() => undefined);
        transition.finished.catch(() => undefined);
        // A report that answered meanwhile follows once this one is in place.
        void transition.updateCallbackDone.finally(() => {
            this.morphing = false;
            this.requestUpdate();
        });
    }
}

/** Keys that move the caret in a single-line input. */
const CARET_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** A press on a name keeps the focus in the input (and the on-screen keyboard open). */
function keepFocus(event: Event): void {
    event.preventDefault();
}

interface ViewTransitionScope {
    startViewTransition(update: ViewTransitionUpdateCallback): ViewTransition;
}

function isViewTransitionScope(target: object): target is ViewTransitionScope {
    return 'startViewTransition' in target && typeof target.startViewTransition === 'function';
}

/**
 * How to change the report with a view transition: scoped to its scroll area where the browser
 * can, so the input stays live and still; else over the whole page; none without support or when
 * the person prefers reduced motion.
 */
function morphOf(area: HTMLElement): ViewTransitionScope['startViewTransition'] | undefined {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (isViewTransitionScope(area)) return update => area.startViewTransition(update);
    if (isViewTransitionScope(document)) return update => document.startViewTransition(update);
    return undefined;
}

/** What keeps the Book from its reports, in the interface's language, names isolated. */
function problemMessage(problem: BookProblem, lang: string): string {
    switch (problem.code) {
        case 'empty_book':
            return t('problem_empty_book', lang);
        case 'nothing_to_report':
            return t('problem_nothing_to_report', lang, {
                count: formatCount(problem.ungrouped, lang),
                total: formatCount(problem.total, lang),
            });
        case 'no_net_result':
            return problem.shared.length
                ? t('problem_no_net_result_shared', lang, {
                      groups: formatList(problem.shared.map(isolate), lang),
                  })
                : t('problem_no_net_result', lang);
        case 'mixed_group':
            return t('problem_mixed_group', lang, { group: isolate(problem.group) });
    }
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
