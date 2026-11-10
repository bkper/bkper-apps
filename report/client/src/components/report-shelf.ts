import type { WaSelectEvent } from '@awesome.me/webawesome-pro/dist/events/select.js';
import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { isolate } from 'report-shared/bidi';
import { t, textDirection, type StringKey } from 'report-shared/strings';
import type { SavedPrompt } from '../api/app-api';
import type { AppState } from '../state/app-state';
import type { SavedPromptsError, ShelfPlace } from '../state/saved-prompts';
import { watch } from '../state/store';
import './report-suggestions';
import { ShelfDrag } from './shelf-drag';

export type ReportShelfState = Pick<AppState, 'route' | 'reports' | 'savedPrompts' | 'strings'>;

export const OPEN_SAVED_REPORT = 'report-open-saved';

/**
 * The menu's moves, labelled by what the person sees: left is earlier in the row in
 * left-to-right languages and later in right-to-left ones.
 */
function moves(dir: 'ltr' | 'rtl'): readonly { label: StringKey; place: ShelfPlace }[] {
    return [
        { label: 'shelf_move_first', place: 'first' },
        { label: 'shelf_move_left', place: dir === 'rtl' ? 'later' : 'earlier' },
        { label: 'shelf_move_right', place: dir === 'rtl' ? 'earlier' : 'later' },
    ];
}

const REMOVE = 'remove';

// Inline: a strict content security policy would block wa-icon's fetches.
const MORE = html`<svg class="glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    ${svg`<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>`}
</svg>`;

type WaButton = HTMLElementTagNameMap['wa-button'];

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

        /* Reordering by drag (see shelf-drag.ts): a long press picks a chip up, not the text. */
        .items > wa-button-group {
            -webkit-touch-callout: none;
            user-select: none;
        }

        .items[data-dragging] > wa-button-group {
            will-change: transform;
        }

        @media (prefers-reduced-motion: no-preference) {
            .items[data-dragging] > wa-button-group:not([data-lifted]),
            .items[data-dragging] > wa-button-group[data-away] {
                transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
            }
        }

        wa-button-group[data-lifted] {
            position: relative;
            z-index: 1;
            border-radius: var(--wa-border-radius-pill);
            box-shadow: var(--wa-shadow-s);
            cursor: grabbing;
        }

        wa-button-group[data-lifted] wa-button::part(button) {
            background-color: var(--wa-color-brand-fill-quiet);
            border-color: var(--wa-color-brand-border-loud);
            color: var(--wa-color-brand-on-quiet);
            cursor: grabbing;
        }

        .saved-prompt::part(button) {
            max-inline-size: 100%;
        }

        .saved-prompt::part(label) {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .options::part(button) {
            padding-inline: var(--bkper-spacing-small);
        }

        .glyph {
            inline-size: 1em;
            block-size: 1em;
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

    /** Announced after a move, while the shelf shows the order it confirmed. */
    @state() private moved?: { items: readonly SavedPrompt[]; text: string };
    /** The chip holding focus before a render, which may move or drop it. */
    private focused?: { id: string; index: number; control: 'saved-prompt' | 'options' };

    /** Reorders saved prompts by dragging them along the row, for those who may move them. */
    private readonly drag = new ShelfDrag(this, {
        row: () => this.renderRoot.querySelector<HTMLElement>('.items'),
        chips: () => this.chips(),
        ids: () => this.state.savedPrompts.items.map(item => item.id),
        canMove: () =>
            this.state.savedPrompts.canMove &&
            this.state.savedPrompts.bookId === this.state.route.bookId,
        move: (id, before) => this.moveTo(id, before, false),
    });

    constructor() {
        super();
        watch(this, () => [
            this.state.savedPrompts,
            this.state.reports,
            this.state.strings,
            this.state.route,
        ]);
    }

    render() {
        const { savedPrompts: shelf, reports } = this.state;
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
            this.error(shelf.moveError, 'shelf_move_error', shelf.capabilities?.move),
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
                                      <wa-button-group label=${item.prompt} data-id=${item.id}>
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
                                          ${this.menu(item)}
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
                ${shelf.loading ? t('shelf_loading', lang) : saving ? t('shelf_saving', lang) : shelf.removing ? t('shelf_removing', lang) : this.moved?.items === shelf.items ? this.moved.text : saved ? t('shelf_saved', lang) : nothing}
            </div>
            ${
                failed
                    ? html`
                          <wa-button
                              class="reload"
                              size="s"
                              appearance="plain"
                              variant="neutral"
                              ?disabled=${shelf.loading || saving || shelf.removing !== undefined || shelf.moving !== undefined}
                              @click=${() => void shelf.load()}
                              >${t('shelf_reload', lang)}</wa-button
                          >
                      `
                    : nothing
            }
        `;
    }

    /** One menu per saved prompt: the moves the person may make, then Remove. */
    private menu(item: SavedPrompt) {
        const shelf = this.state.savedPrompts;
        const lang = this.state.strings.language;
        const move = shelf.capabilities?.move === true;
        const remove = shelf.capabilities?.remove === true;
        if (!move && !remove) return nothing;
        const label = t('shelf_options', lang, { prompt: isolate(item.prompt) });
        return html`
            <wa-dropdown
                placement="top-end"
                @wa-select=${(event: WaSelectEvent) => this.select(item.id, event)}
            >
                <wa-button
                    slot="trigger"
                    class="options"
                    pill
                    size="s"
                    appearance="outlined"
                    variant="neutral"
                    title=${label}
                    aria-label=${label}
                    ?loading=${shelf.removing === item.id}
                    >${MORE}</wa-button
                >
                ${
                    move
                        ? moves(textDirection(lang)).map(
                              ({ label, place }) => html`
                                  <wa-dropdown-item
                                      value=${place}
                                      ?disabled=${!shelf.canMove || shelf.beforeFor(item.id, place) === undefined}
                                      >${t(label, lang)}</wa-dropdown-item
                                  >
                              `
                          )
                        : nothing
                }
                ${move && remove ? html`<wa-divider></wa-divider>` : nothing}
                ${
                    remove
                        ? html`
                              <wa-dropdown-item
                                  value=${REMOVE}
                                  variant="danger"
                                  ?disabled=${!shelf.canRemove}
                                  >${t('shelf_remove', lang)}</wa-dropdown-item
                              >
                          `
                        : nothing
                }
            </wa-dropdown>
        `;
    }

    private select(id: string, event: WaSelectEvent): void {
        const value = event.detail.item.getAttribute('value');
        if (value === REMOVE) void this.state.savedPrompts.remove(id);
        else if (value === 'first' || value === 'earlier' || value === 'later') {
            // Once the menu has closed, so it fades where it was rather than following its chip.
            event.detail.item
                .closest('wa-dropdown')
                ?.addEventListener('wa-after-hide', () => void this.move(id, value), {
                    once: true,
                });
        }
    }

    /** Move a prompt from its menu, keeping it in view. */
    private async move(id: string, place: ShelfPlace): Promise<void> {
        const shelf = this.state.savedPrompts;
        const before = shelf.beforeFor(id, place);
        if (before === undefined || !shelf.canMove) return;
        await this.moveTo(id, before, true);
    }

    /**
     * Move a prompt before `before` (`null`: the end), at once; once the shelf confirms its new
     * order, announce where it is. A dragged chip is in view already, so only the menu reveals.
     */
    private async moveTo(id: string, before: string | null, reveal: boolean): Promise<void> {
        const shelf = this.state.savedPrompts;
        const done = shelf.move(id, before);
        await this.updateComplete;
        if (reveal) this.reveal(id);
        await done;
        const index = shelf.items.findIndex(item => item.id === id);
        if (shelf.moveError || index === -1) return;
        const number = new Intl.NumberFormat(this.state.strings.language);
        this.moved = {
            items: shelf.items,
            text: t('shelf_moved', this.state.strings.language, {
                position: number.format(index + 1),
                count: number.format(shelf.items.length),
            }),
        };
        await this.updateComplete;
        if (reveal) this.reveal(id);
    }

    /** The focused element of the shelf's own tree, found from the document down. */
    private active(): Element | undefined {
        let active = this.ownerDocument.activeElement;
        while (active) {
            if (active.getRootNode() === this.renderRoot) return active;
            active = active.shadowRoot?.activeElement ?? null;
        }
        return undefined;
    }

    private chips(): HTMLElement[] {
        return Array.from(
            this.renderRoot.querySelectorAll<HTMLElement>('wa-button-group[data-id]')
        );
    }

    /** Scroll a chip into the row's view, without moving the page around it. */
    private reveal(id: string): void {
        this.chips()
            .find(chip => chip.dataset.id === id)
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    protected willUpdate(changed: PropertyValues<this>): void {
        super.willUpdate(changed);
        const active = this.active();
        const chips = this.chips();
        const index = active ? chips.findIndex(chip => chip.contains(active)) : -1;
        const id = chips[index]?.dataset.id;
        this.focused =
            id && active
                ? {
                      id,
                      index,
                      control: active.classList.contains('saved-prompt')
                          ? 'saved-prompt'
                          : 'options',
                  }
                : undefined;
    }

    /**
     * A render that moves a chip in the row, or removes it, drops the focus it held. Give it
     * back to the same control of that chip, or of the one now in its place.
     */
    protected updated(changed: PropertyValues<this>): void {
        super.updated(changed);
        const focused = this.focused;
        this.focused = undefined;
        if (!focused || this.active()) return;
        const chips = this.chips();
        const chip =
            chips.find(entry => entry.dataset.id === focused.id) ??
            chips[Math.min(focused.index, chips.length - 1)];
        const button =
            chip?.querySelector<WaButton>(`.${focused.control}`) ??
            chip?.querySelector<WaButton>('.saved-prompt');
        if (!chip || !button) return;
        button.focus({ preventScroll: true });
        // A drop keeps the row where the person left it.
        if (!this.drag.active) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    private suggestions() {
        const { reports, strings } = this.state;
        return html`<report-suggestions
            .suggestions=${reports.suggestions}
            label=${t('suggestions_label', strings.language)}
            loading-label=${t('suggestions_loading', strings.language)}
        ></report-suggestions>`;
    }

    private error(error: SavedPromptsError | undefined, key: StringKey, accessRestored = false) {
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
