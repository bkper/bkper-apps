import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { isolate } from 'report-shared/bidi';
import { t, type StringKey } from 'report-shared/strings';
import type { AppState } from '../state/app-state';
import type { SavedReportsError } from '../state/saved-reports';
import { watch } from '../state/store';
import './report-suggestions';

export type ReportShelfState = Pick<AppState, 'route' | 'reports' | 'savedReports' | 'strings'>;

export const OPEN_SAVED_REPORT = 'report-open-saved';

/** The Book's shared prompts and the shown report's Save action, never the draft input. */
@customElement('report-shelf')
export class ReportShelf extends LitElement {
    static styles = css`
        :host {
            display: block;
            min-inline-size: 0;
        }

        /* One bounded row, even with many prompts or at phone widths. Save stays in reach. */
        .row,
        .items {
            display: flex;
            align-items: center;
            gap: var(--bkper-spacing-x-small);
            min-inline-size: 0;
        }

        .items {
            flex: 1;
            overflow-x: auto;
            overscroll-behavior-inline: contain;
            padding: var(--bkper-spacing-2x-small);
            scroll-padding-inline: var(--bkper-spacing-x-small);
        }

        .items > *,
        .save {
            flex: none;
        }

        .saved-prompt {
            max-inline-size: min(32ch, 55vw);
        }

        .saved-prompt::part(button) {
            max-inline-size: 100%;
        }

        .saved-prompt::part(label) {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .remove::part(button) {
            padding-inline: var(--bkper-spacing-small);
        }

        .feedback {
            margin: 0;
            font-size: var(--wa-font-size-s);
            color: var(--wa-color-text-quiet);
        }

        .error {
            color: var(--wa-color-danger-on-quiet);
        }

        .visually-hidden {
            position: absolute;
            inline-size: 1px;
            block-size: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
        }
    `;

    @property({ attribute: false }) state!: ReportShelfState;
    /** Save is unavailable while the page is still transitioning to the store's next report. */
    @property({ type: Boolean }) current = true;

    constructor() {
        super();
        watch(this, () => [
            this.state.savedReports,
            this.state.reports,
            this.state.strings,
            this.state.route,
        ]);
    }

    render() {
        const { savedReports: shelf, reports } = this.state;
        // Never expose the previous Book's items or source during navigation.
        if (shelf.bookId !== this.state.route.bookId) return this.suggestions();
        const lang = this.state.strings.language;
        const source = reports.originalPrompt;
        const saved = source !== undefined && shelf.isSaved(source);
        const saving = shelf.saving !== undefined;
        const saveLabel = t(saving ? 'shelf_saving' : saved ? 'shelf_saved' : 'shelf_save', lang);
        const errors = [
            this.error(shelf.loadError, 'shelf_load_error'),
            this.error(shelf.saveError, 'shelf_save_error', shelf.capabilities?.save),
            this.error(shelf.removeError, 'shelf_remove_error', shelf.capabilities?.remove),
        ];
        const failed = errors.some(error => error !== nothing);
        return html`
            ${errors}
            <div class="row">
                <div class="items" role="group" aria-label=${t('shelf_label', lang)}>
                    ${
                        shelf.items.length
                            ? repeat(
                                  shelf.items,
                                  item => item.id,
                                  item => html`
                                      <wa-button-group label=${item.prompt}>
                                          <wa-button
                                              class="saved-prompt"
                                              pill
                                              size="s"
                                              appearance="outlined"
                                              variant="neutral"
                                              title=${item.prompt}
                                              aria-label=${item.prompt}
                                              ?disabled=${!shelf.canList}
                                              @click=${() => this.dispatchEvent(new CustomEvent(OPEN_SAVED_REPORT, { detail: item.id, bubbles: true, composed: true }))}
                                              ><bdi>${item.prompt}</bdi></wa-button
                                          >
                                          ${
                                              shelf.capabilities?.remove
                                                  ? html`
                                                        <wa-button
                                                            class="remove"
                                                            pill
                                                            size="s"
                                                            appearance="outlined"
                                                            variant="neutral"
                                                            title=${t('shelf_remove', lang, { prompt: isolate(item.prompt) })}
                                                            aria-label=${t('shelf_remove', lang, { prompt: isolate(item.prompt) })}
                                                            ?loading=${shelf.removing === item.id}
                                                            ?disabled=${!shelf.canRemove}
                                                            @click=${() => void shelf.remove(item.id)}
                                                            ><span aria-hidden="true"
                                                                >×</span
                                                            ></wa-button
                                                        >
                                                    `
                                                  : nothing
                                          }
                                      </wa-button-group>
                                  `
                              )
                            : this.suggestions()
                    }
                </div>
                ${
                    (source && shelf.capabilities?.save) || saving
                        ? html`
                              <wa-button
                                  class="save"
                                  size="s"
                                  pill
                                  appearance="plain"
                                  variant="neutral"
                                  title=${shelf.saving ?? source ?? ''}
                                  aria-label=${saving || saved ? `${saveLabel} ${isolate(shelf.saving ?? source ?? '')}` : t('shelf_save_label', lang, { prompt: isolate(source ?? '') })}
                                  ?loading=${saving}
                                  ?disabled=${!this.current || !shelf.canSave || saved}
                                  @click=${() => void shelf.save()}
                                  >${saveLabel}</wa-button
                              >
                          `
                        : nothing
                }
            </div>
            <div
                class=${shelf.loading ? 'feedback' : 'visually-hidden'}
                role="status"
                aria-live="polite"
            >
                ${shelf.loading ? t('shelf_loading', lang) : saving ? t('shelf_saving', lang) : shelf.removing ? t('shelf_removing', lang) : saved ? t('shelf_saved', lang) : nothing}
            </div>
            ${
                failed
                    ? html`
                          <wa-button
                              class="reload"
                              size="s"
                              appearance="plain"
                              variant="neutral"
                              ?disabled=${shelf.loading || saving || shelf.removing !== undefined}
                              @click=${() => void shelf.load()}
                              >${t('shelf_reload', lang)}</wa-button
                          >
                      `
                    : nothing
            }
        `;
    }

    private suggestions() {
        const { reports, strings } = this.state;
        return html`<report-suggestions
            .suggestions=${reports.suggestions}
            label=${t('suggestions_label', strings.language)}
            loading-label=${t('suggestions_loading', strings.language)}
        ></report-suggestions>`;
    }

    private error(error: SavedReportsError | undefined, key: StringKey, accessRestored = false) {
        if (!error) return nothing;
        const access =
            error === 'forbidden' || error === 'unauthorized' || error === 'book_not_found';
        // A successful explicit reload can restore permission without another mutation.
        if (access && accessRestored) return nothing;
        return html`<p class="feedback error" role="alert">
            ${t(access ? 'shelf_access_error' : key, this.state.strings.language)}
        </p>`;
    }
}

declare global {
    interface HTMLElementEventMap {
        [OPEN_SAVED_REPORT]: CustomEvent<string>;
    }
    interface HTMLElementTagNameMap {
        'report-shelf': ReportShelf;
    }
}
